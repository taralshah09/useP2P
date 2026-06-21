import { ConnectionStateMachine, CONNECTION_STATES } from './connectionState.js';
import { SIGNALING_TYPES } from 'shared/src/signaling-messages.js';

export class PeerConnectionManager {
  constructor(signalingClient, iceConfig, isSender = false) {
    this.signalingClient = signalingClient;
    this.iceConfig = iceConfig;
    this.isSender = isSender;
    this.pc = null;
    this.dataChannel = null;
    
    this.stateMachine = new ConnectionStateMachine((state, reason) => {
      if (this.onStateChange) this.onStateChange(state, reason);
    });

    this.onDataChannelMessage = null;
    this.onStateChange = null;

    this.setupSignalingHandlers();
  }

  setupSignalingHandlers() {
    this.signalingClient.on(SIGNALING_TYPES.PEER_JOINED, async () => {
      // Sender creates offer when peer joins
      if (this.isSender) {
        this.stateMachine.transition(CONNECTION_STATES.CONNECTING);
        try {
          await this.createOffer();
        } catch (e) {
          this.stateMachine.fail(e.message);
        }
      }
    });

    this.signalingClient.on(SIGNALING_TYPES.OFFER, async (msg) => {
      if (!this.isSender) {
        this.stateMachine.transition(CONNECTION_STATES.CONNECTING);
        try {
          await this.handleOffer(msg.offer);
        } catch (e) {
          this.stateMachine.fail(e.message);
        }
      }
    });

    this.signalingClient.on(SIGNALING_TYPES.ANSWER, async (msg) => {
      if (this.isSender) {
        try {
          await this.handleAnswer(msg.answer);
        } catch (e) {
          this.stateMachine.fail(e.message);
        }
      }
    });

    this.signalingClient.on(SIGNALING_TYPES.ICE_CANDIDATE, async (msg) => {
      try {
        await this.handleIceCandidate(msg.candidate);
      } catch (e) {
        console.warn('Error handling ICE candidate', e);
      }
    });
    
    this.signalingClient.on(SIGNALING_TYPES.SESSION_EXPIRED, () => {
      this.stateMachine.fail('Session expired');
      this.close();
    });

    this.signalingClient.on(SIGNALING_TYPES.ERROR, (msg) => {
      const reason = msg.payload?.message || 'Signaling error';
      this.stateMachine.fail(reason);
      this.close();
    });
  }

  initialize() {
    this.pc = new RTCPeerConnection(this.iceConfig);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const c = event.candidate;
        const type = c.type || (c.candidate.match(/typ (\w+)/)?.[1] ?? '?');
        console.log(`[ICE] gathered ${type} candidate:`, c.candidate);
        if (this.onIceCandidate) this.onIceCandidate(type, c.candidate);
        this.signalingClient.send({
          type: SIGNALING_TYPES.ICE_CANDIDATE,
          candidate: event.candidate
        });
      } else {
        console.log('[ICE] gathering complete');
        if (this.onIceCandidate) this.onIceCandidate('done', null);
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log('[ICE] gathering state:', this.pc.iceGatheringState);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('[ICE] connection state:', this.pc.iceConnectionState);
      switch (this.pc.iceConnectionState) {
        case 'failed':
        case 'closed':
        case 'disconnected':
          this.stateMachine.fail(`ICE connection state: ${this.pc.iceConnectionState}`);
          break;
      }
    };

    this.pc.onconnectionstatechange = () => {
      switch (this.pc.connectionState) {
        case 'connected':
          this.stateMachine.transition(CONNECTION_STATES.CONNECTED);
          break;
        case 'failed':
        case 'closed':
        case 'disconnected':
          this.stateMachine.fail(`Connection state: ${this.pc.connectionState}`);
          break;
      }
    };

    if (this.isSender) {
      // Create DataChannel (reliable and ordered by default)
      this.dataChannel = this.pc.createDataChannel('p2p-transfer');
      this.setupDataChannel();
    } else {
      // Receiver waits for DataChannel
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }
  }

  setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      if (this.isSender) {
        this.stateMachine.transition(CONNECTION_STATES.AWAITING_APPROVAL);
      } else {
        // Receiver is ready as soon as channel is open, but waits for sender's metadata
        // For MVP, we transition to AWAITING_APPROVAL to wait for sender
        this.stateMachine.transition(CONNECTION_STATES.AWAITING_APPROVAL);
      }
    };

    this.dataChannel.onclose = () => {
      if (this.stateMachine.getState() !== CONNECTION_STATES.COMPLETE) {
        this.stateMachine.fail('Data channel closed unexpectedly');
      }
    };

    this.dataChannel.onerror = (error) => {
      this.stateMachine.fail('Data channel error: ' + error.message);
    };

    this.dataChannel.onmessage = (event) => {
      if (this.onDataChannelMessage) {
        this.onDataChannelMessage(event.data);
      }
    };
  }

  async createOffer() {
    this.initialize();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signalingClient.send({
      type: SIGNALING_TYPES.OFFER,
      offer: offer
    });
  }

  async handleOffer(offer) {
    this.initialize();
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signalingClient.send({
      type: SIGNALING_TYPES.ANSWER,
      answer: answer
    });
  }

  async handleAnswer(answer) {
    if (this.pc) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async handleIceCandidate(candidate) {
    if (this.pc && this.pc.remoteDescription) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      // ICE candidate arrived before remote description
      // In a robust implementation, queue these candidates. 
      // For MVP, we hope sequential ordering holds, or add a simple queue.
      if (!this.candidateQueue) this.candidateQueue = [];
      this.candidateQueue.push(candidate);
      
      // We should flush this queue after setRemoteDescription
      // Let's monkey patch or just check on next tick
    }
  }
  
  flushIceCandidates() {
    if (this.candidateQueue && this.pc && this.pc.remoteDescription) {
      for (const candidate of this.candidateQueue) {
        this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn('Queued ICE failed', e));
      }
      this.candidateQueue = [];
    }
  }

  // Override handleOffer and handleAnswer to flush candidates
  async handleOffer(offer) {
    this.initialize();
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.flushIceCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signalingClient.send({
      type: SIGNALING_TYPES.ANSWER,
      answer: answer
    });
  }

  async handleAnswer(answer) {
    if (this.pc) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.flushIceCandidates();
    }
  }

  sendData(data) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(data);
    } else {
      throw new Error('Data channel is not open');
    }
  }

  close() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    // Only transition to ABORTED if we haven't failed or completed
    const currentState = this.stateMachine.getState();
    if (currentState !== CONNECTION_STATES.FAILED && currentState !== CONNECTION_STATES.COMPLETE) {
      this.stateMachine.abort('Connection closed');
    }
  }
}
