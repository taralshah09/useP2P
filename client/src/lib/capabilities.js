export function supportsFileSystemAccessAPI() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}
