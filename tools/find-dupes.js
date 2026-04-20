(async function() {
  if (!accessToken) { console.error('Not signed in'); return; }
  console.log('Searching...');
  var allFolders = [], pageToken = null;
  do {
    var q = encodeURIComponent("name='After' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=nextPageToken,files(id,name,parents,createdTime)&pageSize=100' + (pageToken ? '&pageToken=' + pageToken : '');
    var r = await fetch(url, {headers:{Authorization:'Bearer ' + accessToken}});
    var data = await r.json();
    if (data.error) { console.error('API error:', data.error.message); return; }
    allFolders = allFolders.concat(data.files || []);
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  console.log('Total After folders found: ' + allFolders.length);
  var byParent = {};
  for (var i = 0; i < allFolders.length; i++) {
    var f = allFolders[i];
    var pid = (f.parents && f.parents[0]) || 'unknown';
    if (!byParent[pid]) byParent[pid] = [];
    byParent[pid].push(f);
  }
  var dupes = Object.keys(byParent).filter(function(k){ return byParent[k].length > 1; });
  if (dupes.length === 0) { console.log('No duplicates found - Drive is clean'); return; }
  console.warn('Found ' + dupes.length + ' job folder(s) with duplicate After subfolders:');
  for (var d = 0; d < dupes.length; d++) {
    var pid2 = dupes[d];
    var folders = byParent[pid2];
    var pname = pid2;
    try {
      var pr = await fetch('https://www.googleapis.com/drive/v3/files/' + pid2 + '?fields=name', {headers:{Authorization:'Bearer ' + accessToken}});
      var pd = await pr.json();
      pname = pd.name || pid2;
    } catch(e) {}
    console.log('Job folder: ' + pname);
    for (var j = 0; j < folders.length; j++) {
      var af = folders[j];
      var count = 0;
      try {
        var cq = encodeURIComponent("'" + af.id + "' in parents and trashed=false");
        var cr = await fetch('https://www.googleapis.com/drive/v3/files?q=' + cq + '&fields=files(id)&pageSize=100', {headers:{Authorization:'Bearer ' + accessToken}});
        var cd = await cr.json();
        count = (cd.files || []).length;
      } catch(e) {}
      var status = count === 0 ? 'EMPTY - likely orphan' : 'HAS ' + count + ' file(s) - real folder';
      console.log('  id=' + af.id + ' created=' + af.createdTime + ' | ' + status);
      console.log('  https://drive.google.com/drive/folders/' + af.id);
    }
  }
})();
