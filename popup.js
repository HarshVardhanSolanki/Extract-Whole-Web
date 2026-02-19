document.addEventListener('DOMContentLoaded', async () => {
    // Check local storage for valid license
    chrome.storage.local.get(['isPaid'], function(data) {
        if(data.isPaid) {
            document.getElementById('license-section').style.display = 'none';
        }
    });

    document.getElementById('searchBtn').addEventListener('click', () => {
        const keyword = document.getElementById('keyword').value;
        if (!keyword) return;

        document.getElementById('status').innerText = "Fetching the web.....";
        document.getElementById('resultsTable').style.display = 'none';
        document.getElementById('paywall').style.display = 'none';
        document.getElementById('tableBody').innerHTML = '';

        // Send message to background script to perform the search
        chrome.runtime.sendMessage({ action: "search", keyword: keyword }, (response) => {
            renderResults(response.data);
        });
    });

    document.getElementById('upgradeBtn').addEventListener('click', () => {
        // Redirect to your Razorpay/Stripe checkout link
        window.open('https://your-razorpay-link.com/checkout', '_blank');
    });

    document.getElementById('verifyBtn').addEventListener('click', () => {
        const key = document.getElementById('licenseKey').value;
        // In production, send this key and a generated Device UUID to your server for validation.
        if(key === "TEST_PREMIUM_KEY") { 
            chrome.storage.local.set({isPaid: true});
            alert("License verified!");
            location.reload();
        } else {
            alert("Invalid Key.");
        }
    });
});

function renderResults(data) {
    document.getElementById('status').innerText = "";
    document.getElementById('resultsTable').style.display = 'table';
    const tbody = document.getElementById('tableBody');
    
    chrome.storage.local.get(['isPaid'], function(storage) {
        const isPaid = storage.isPaid || false;
        
        // Freemium logic: Limit to 2 if not paid
        const displayLimit = isPaid ? data.length : 2;
        const resultsToShow = data.slice(0, displayLimit);

        resultsToShow.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${item.source}</td>
                <td>${item.number || 'NA'}</td>
                <td>${item.email || 'NA'}</td>
            `;
            tbody.appendChild(tr);
        });

        // Show paywall if user isn't paid and there are more results to show
        if (!isPaid && data.length > 2) {
            document.getElementById('paywall').style.display = 'block';
        }
    });
}