// Replace the renderTable function in your popup.js
function renderTable() {
    const tbody = document.getElementById('results-body');
    tbody.innerHTML = '';
    const displayLimit = isPro ? currentResults.length : 2;

    currentResults.forEach((lead, i) => {
        const tr = document.createElement('tr');
        if (i >= displayLimit && !isPro) tr.className = 'locked-row';

        // Column Format: S.No | Website Link | Mobile | Email
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <a href="${lead.source}" target="_blank" style="color: #10b981; text-decoration: none;">${lead.source}</a>
            </td>
            <td style="font-family: monospace;">${lead.number}</td>
            <td style="font-family: monospace;">${lead.email}</td>
        `;

        if (i >= displayLimit && !isPro) {
            const td = document.createElement('td');
            td.colSpan = 4;
            td.style.position = 'absolute';
            td.style.inset = '0';
            td.innerHTML = `
                <div style="display:flex; justify-content:center; align-items:center; width:100%; height:100%; background:rgba(24,24,27,0.85); border-radius: 4px;">
                    <div class="upgrade-teaser-btn" style="background:#10b981; color:white; padding:8px 16px; border-radius:9999px; font-weight:700; cursor:pointer; font-size: 11px;">UNLOCK 100+ LEADS</div>
                </div>`;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
    document.getElementById('table-wrapper').style.display = 'block';
}
