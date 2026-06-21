import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export default function QRScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  // Scan line position 0-100 (percentage within the viewfinder box)
  const [lineY, setLineY] = useState(0);

  // Camera + decode loop
  useEffect(() => {
    let active = true;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera API not available in this browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }

        const video = videoRef.current;
        video.srcObject = stream;
        video.onloadedmetadata = () => { video.play(); setReady(true); };
      } catch (err) {
        if (!active) return;
        setError(
          err.name === 'NotAllowedError'
            ? 'Camera access denied. Please allow camera access in your browser settings and try again.'
            : `Could not start camera: ${err.message}`
        );
      }
    }

    function tick() {
      if (!active) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= HTMLVideoElement.HAVE_ENOUGH_DATA) {
        const { videoWidth: w, videoHeight: h } = video;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          active = false; // stop further frames
          // Stop the camera stream before notifying caller
          video.srcObject?.getTracks().forEach((t) => t.stop());
          onScan(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    start().then(() => { if (active) rafRef.current = requestAnimationFrame(tick); });

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      videoRef.current?.srcObject?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scan-line animation — independent of the decode loop
  useEffect(() => {
    let pos = 0;
    let dir = 1;
    const id = setInterval(() => {
      pos += dir * 1.5;
      if (pos >= 100) { pos = 100; dir = -1; }
      else if (pos <= 0) { pos = 0; dir = 1; }
      setLineY(pos);
    }, 16);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <div>
        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>
        <button className="btn btn-secondary w-full" onClick={onClose}>Go Back</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', background: '#000', lineHeight: 0 }}>
      {/* Live camera feed */}
      <video
        ref={videoRef}
        style={{ width: '100%', display: 'block', opacity: ready ? 1 : 0, transition: 'opacity 0.3s' }}
        playsInline
        muted
      />

      {/* Hidden canvas for jsQR frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Starting indicator */}
      {!ready && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '0.9rem', background: '#000',
        }}>
          Starting camera…
        </div>
      )}

      {/* Overlay: dark surround + transparent viewfinder window */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>

        {/* Top dark band */}
        <div style={{ flex: 1, width: '100%', background: 'rgba(0,0,0,0.55)' }} />

        {/* Middle row: side bands + viewfinder */}
        <div style={{ display: 'flex', width: '100%', alignItems: 'stretch' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.55)' }} />

          {/* ── Viewfinder box ── */}
          <div style={{ position: 'relative', width: '62%', aspectRatio: '1' }}>

            {/* Corner brackets — top-left */}
            <span style={corner('top', 'left')} />
            {/* top-right */}
            <span style={corner('top', 'right')} />
            {/* bottom-left */}
            <span style={corner('bottom', 'left')} />
            {/* bottom-right */}
            <span style={corner('bottom', 'right')} />

            {/* Animated green sweep line */}
            <div style={{
              position: 'absolute',
              left: 0, right: 0,
              top: `${lineY}%`,
              height: 2,
              background: 'linear-gradient(90deg, transparent 0%, #22c55e 30%, #22c55e 70%, transparent 100%)',
              boxShadow: '0 0 10px 2px rgba(34,197,94,0.6)',
              pointerEvents: 'none',
            }} />
          </div>

          <div style={{ flex: 1, background: 'rgba(0,0,0,0.55)' }} />
        </div>

        {/* Bottom dark band */}
        <div style={{ flex: 1, width: '100%', background: 'rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '1rem', gap: '0.75rem' }}>
          <p style={{ color: '#fff', margin: 0, fontSize: '0.875rem', lineHeight: 1.4, textAlign: 'center' }}>
            Point your camera at the QR code
          </p>
          <button
            className="btn btn-secondary"
            style={{ background: 'rgba(255,255,255,0.9)', fontSize: '0.875rem', padding: '0.4rem 1.25rem' }}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Returns inline styles for one corner bracket
function corner(v, h) {
  const SIZE = 22;
  const THICKNESS = 3;
  const OFFSET = -2;
  const RADIUS = 3;
  return {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    [v]: OFFSET,
    [h]: OFFSET,
    borderTop: v === 'top' ? `${THICKNESS}px solid #fff` : 'none',
    borderBottom: v === 'bottom' ? `${THICKNESS}px solid #fff` : 'none',
    borderLeft: h === 'left' ? `${THICKNESS}px solid #fff` : 'none',
    borderRight: h === 'right' ? `${THICKNESS}px solid #fff` : 'none',
    borderTopLeftRadius: v === 'top' && h === 'left' ? RADIUS : 0,
    borderTopRightRadius: v === 'top' && h === 'right' ? RADIUS : 0,
    borderBottomLeftRadius: v === 'bottom' && h === 'left' ? RADIUS : 0,
    borderBottomRightRadius: v === 'bottom' && h === 'right' ? RADIUS : 0,
  };
}
