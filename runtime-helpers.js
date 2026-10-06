// Small runtime helpers used by app.js. Keep this file dependency-free for GitHub Pages.
function pager(prefix, page, totalPages, totalRows) {
  var prev = prefix + 'Prev';
  var next = prefix + 'Next';
  return '<div class="pager"><span class="footer">Halaman ' + Number(page).toLocaleString('id-ID') +
    ' / ' + Number(totalPages).toLocaleString('id-ID') + ' • ' +
    Number(totalRows).toLocaleString('id-ID') + ' baris</span><div class="actions">' +
    '<button class="button" id="' + prev + '" ' + (page <= 1 ? 'disabled' : '') +
    '>Sebelumnya</button><button class="button" id="' + next + '" ' +
    (page >= totalPages ? 'disabled' : '') + '>Berikutnya</button></div></div>';
}
