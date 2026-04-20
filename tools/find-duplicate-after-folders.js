/**
 * Paste this entire script into the browser console while signed in to AEDEXBOOKS.
 * It queries Google Drive for all "After" folders created by the app and reports
 * any job folder that has more than one — the orphans created by the bug.
 *
 * READ-ONLY — does not delete or modify anything.
 */
(async () => {
  if (!accessToken) { console.error('Not signed in — sign in first then re-run'); return; }

  console.log('Searching Drive for all "After" folders...');

  // Paginate through all After folders (app may have many jobs)
  let allFolders = [];
  let pageToken = null;
  do {
    const q = encodeURIComponent(`name='After' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,parents,createdTime)&pageSize=100${pageToken ? '&pageToken=' + pageToken : ''}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    const data = await r.json();
    if (data.error) { console.error('Drive API error:', data.error.message); return; }
    allFolders = allFolders.concat(data.files || []);
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  console.log(`Found ${allFolders.length} total "After" folder(s)`);

  // Group by parent folder (each job folder should have exactly one After subfolder)
  const byParent = {};
  for (const f of allFolders) {
    const parentId = f.parents?.[0] || 'unknown';
    if (!byParent[parentId]) byParent[parentId] = [];
    byParent[parentId].push(f);
  }

  // Find parents with more than one After folder = duplicates from the bug
  const duplicateParents = Object.entries(byParent).filter(([, folders]) => folders.length > 1);

  if (duplicateParents.length === 0) {
    console.log('%c✓ No duplicate After folders found — Drive is clean', 'color: green; font-weight: bold');
    return;
  }

  console.warn(`%c⚠ Found ${duplicateParents.length} job folder(s) with duplicate After subfolders:`, 'color: orange; font-weight: bold');

  // For each duplicated parent, fetch its name so the report is readable
  for (const [parentId, folders] of duplicateParents) {
    let parentName = parentId;
    try {
      const pr = await fetch(`https://www.googleapis.com/drive/v3/files/${parentId}?fields=name`, { headers: { Authorization: 'Bearer ' + accessToken } });
      const pd = await pr.json();
      parentName = pd.name || parentId;
    } catch {}

    // For each After folder, count how many files it contains
    const withCounts = await Promise.all(folders.map(async f => {
      try {
        const cr = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${f.id}' in parents and trashed=false`)}&fields=files(id)&pageSize=100`,
          { headers: { Authorization: 'Bearer ' + accessToken } }
        );
        const cd = await cr.json();
        return { ...f, fileCount: (cd.files || []).length };
      } catch {
        return { ...f, fileCount: '?' };
      }
    }));

    console.group(`📁 Job folder: "${parentName}" (${parentId})`);
    for (const f of withCounts.sort((a, b) => a.createdTime.localeCompare(b.createdTime))) {
      const isEmpty = f.fileCount === 0;
      const label = isEmpty ? '🗑 EMPTY (likely orphan from bug)' : `✅ HAS ${f.fileCount} FILE(S) (real folder)`;
      console.log(`  After folder: ${f.id} | Created: ${f.createdTime} | ${label}`);
      console.log(`    Drive link: https://drive.google.com/drive/folders/${f.id}`);
    }
    console.groupEnd();
  }

  console.log('\nReview the above before deleting anything. The EMPTY folder created AFTER the real one is the orphan.');
})();
