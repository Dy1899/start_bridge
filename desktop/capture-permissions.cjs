// Electron <=44 reports display capture as `media` with no device mediaTypes.
// See v44.9.1 WebContentsPermissionHelper::RequestMediaAccessPermission.
function allowCapturePermission({ phase, permission, details, webContents, expectedWebContents, uiUrl, armed, electronMajor }) {
  if (!armed || !expectedWebContents || webContents !== expectedWebContents) return false;
  if (!details || details.isMainFrame !== true || details.requestingUrl !== uiUrl) return false;
  if (permission === 'display-capture') return true;
  // A legacy media check cannot distinguish devices from display capture. Deny
  // it and decide at the request stage, which includes the actual mediaTypes.
  if (phase !== 'request' || permission !== 'media') return false;
  if (!Number.isInteger(electronMajor) || electronMajor < 1 || electronMajor >= 45) return false;
  return Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0;
}
module.exports = { allowCapturePermission };
