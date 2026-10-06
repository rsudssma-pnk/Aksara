const SUPABASE_HOST = 'nbewlpbbvtwtuvamadle.supabase.co';

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_({
    ok: true,
    service: 'AKSARA Google Drive Backup',
    version: '1.0.1',
    timestamp: new Date().toISOString(),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'backup') throw new Error('Invalid action.');

    const storageUrl = String(body.storageUrl || '');
    if (!storageUrl.startsWith('https://' + SUPABASE_HOST + '/')) throw new Error('Storage URL is not an approved Supabase URL.');

    const fileName = sanitizeName_(body.fileName || 'evidence');
    const mimeType = body.mimeType || 'application/octet-stream';
    const pokjaCode = sanitizeName_(body.pokjaCode || 'UNKNOWN');
    const epCode = sanitizeName_(body.epCode || 'UNKNOWN');
    const folderPath = pokjaCode + '/EP ' + epCode;

    const props = PropertiesService.getScriptProperties();
    const rootId = props.getProperty('AKSARA_DRIVE_ROOT_ID');
    const root = rootId ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();

    const pokjaFolder = getOrCreateFolder_(root, pokjaCode);
    const epFolder = getOrCreateFolder_(pokjaFolder, 'EP ' + epCode);

    const response = UrlFetchApp.fetch(storageUrl, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
    });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error('Supabase download failed: HTTP ' + response.getResponseCode());
    }

    const evidenceId = String(body.evidenceId || '');
    const versionId = String(body.evidenceVersionId || '');
    const description = 'AKSARA Evidence | Evidence ID: ' + evidenceId + ' | Version ID: ' + versionId + ' | EP: ' + epCode + ' | Pokja: ' + pokjaCode;

    const existing = epFolder.getFilesByName(fileName);
    while (existing.hasNext()) {
      const candidate = existing.next();
      const d = candidate.getDescription() || '';
      if (d.indexOf('Evidence ID: ' + evidenceId) !== -1 && d.indexOf('Version ID: ' + versionId) !== -1) {
        return json_({ ok: true, fileId: candidate.getId(), fileUrl: candidate.getUrl(), folderPath: folderPath, fileName: candidate.getName(), existing: true });
      }
    }

    const blob = response.getBlob().setName(fileName).setContentType(mimeType);
    const file = epFolder.createFile(blob);
    file.setDescription(description);

    return json_({
      ok: true,
      fileId: file.getId(),
      fileUrl: file.getUrl(),
      folderPath: folderPath,
      fileName: file.getName(),
      bytes: blob.getBytes().length,
    });
  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateFolder_(parent, name) {
  const safe = sanitizeName_(name);
  const found = parent.getFoldersByName(safe);
  return found.hasNext() ? found.next() : parent.createFolder(safe);
}

function sanitizeName_(name) {
  return String(name || 'UNKNOWN')
    .replace(/[\\/:*?"<>|#%{}]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'UNKNOWN';
}

function testDriveBackupConfiguration() {
  const props = PropertiesService.getScriptProperties();
  const rootId = props.getProperty('AKSARA_DRIVE_ROOT_ID');
  const root = rootId ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();
  Logger.log('AKSARA Drive Backup OK: ' + root.getName());
}
