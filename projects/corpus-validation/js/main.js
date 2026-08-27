// Accessibility Image Validator

(function () {
    'use strict';

    const GITHUB_ISSUE_BASE =
        'https://github.com/EqualifyEverything/benchmarks-ai-alt/issues/new';

    // State
    let sessionId = null;
    let sessionActive = false;
    let currentIndex = 0;
    let results = [];
    let corpus = [];
    let pendingDecision = null; // 'accepted' or 'rejected'

    // DOM refs
    const els = {};

    function init() {
        // Cache elements
        els.startBtn = document.getElementById('start-session');
        els.endBtn = document.getElementById('end-session');
        els.sessionStatus = document.getElementById('session-status');
        els.sessionId = document.getElementById('session-id-display');
        els.progressCount = document.getElementById('progress-count');
        els.totalCount = document.getElementById('total-count');
        els.progressBar = document.getElementById('progress-bar');
        els.progressFill = document.getElementById('progress-fill');
        els.card = document.getElementById('validation-card');
        els.image = document.getElementById('current-image');
        els.placeholder = document.getElementById('image-placeholder');
        els.altText = document.getElementById('current-alt');
        els.acceptBtn = document.getElementById('accept-btn');
        els.rejectBtn = document.getElementById('reject-btn');
        els.reasonGroup = document.getElementById('reason-group');
        els.reasonInput = document.getElementById('reason-input');
        els.reasonLabel = document.getElementById('reason-label');
        els.reasonHint = document.getElementById('reason-hint');
        els.submitBtn = document.getElementById('submit-btn');
        els.cancelBtn = document.getElementById('cancel-btn');
        els.results = document.getElementById('results');
        els.resultsSummary = document.getElementById('results-summary');
        els.downloadBtn = document.getElementById('download-results');
        els.issueLink = document.getElementById('github-issue-link');
        els.contextPage = document.getElementById('context-page');
        els.contextRole = document.getElementById('context-role');
        els.contextSurrounding = document.getElementById('context-surrounding');

        // Events
        els.startBtn.addEventListener('click', startSession);
        els.endBtn.addEventListener('click', endSession);
        els.acceptBtn.addEventListener('click', function () { choose('accepted'); });
        els.rejectBtn.addEventListener('click', function () { choose('rejected'); });
        els.submitBtn.addEventListener('click', submitReason);
        els.cancelBtn.addEventListener('click', cancelReason);
        els.downloadBtn.addEventListener('click', downloadResults);

        // Keyboard: Enter in textarea submits
        els.reasonInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.ctrlKey) {
                submitReason();
            }
        });

        loadCorpus();
    }

    // Data loading
    async function loadCorpus() {
        try {
            let response = await fetch('./functional-images.jsonl');
            if (!response.ok) {
                response = await fetch(
                    '../projects/corpus-construction/corpus/functional-images.jsonl'
                );
            }
            const text = await response.text();
            corpus = text.trim().split('\n').map(function (line) {
                try { return JSON.parse(line); }
                catch (e) { return null; }
            }).filter(Boolean);
        } catch (err) {
            console.error('Failed to load corpus:', err);
        }
    }

    // Session management
    function startSession() {
        if (corpus.length === 0) {
            alert('No corpus data loaded. Check the data file.');
            return;
        }

        sessionId = 'v-' + Date.now().toString(36) + '-' +
            Math.random().toString(36).substr(2, 5);
        sessionActive = true;
        currentIndex = 0;
        results = [];
        pendingDecision = null;

        els.sessionId.textContent = sessionId;
        els.totalCount.textContent = corpus.length;
        updateProgress();

        show(els.sessionStatus);
        show(els.card);
        hide(els.results);

        els.startBtn.disabled = true;
        els.startBtn.setAttribute('aria-disabled', 'true');
        els.endBtn.disabled = false;
        els.endBtn.removeAttribute('aria-disabled');

        loadItem();
    }

    function endSession() {
        sessionActive = false;
        pendingDecision = null;

        hide(els.card);
        hide(els.sessionStatus);
        hide(els.reasonGroup);
        show(els.results);

        els.startBtn.disabled = false;
        els.startBtn.removeAttribute('aria-disabled');
        els.endBtn.disabled = true;
        els.endBtn.setAttribute('aria-disabled', 'true');

        // Summary
        var accepted = results.filter(function (r) { return r.status === 'accepted'; }).length;
        var rejected = results.filter(function (r) { return r.status === 'rejected'; }).length;
        var total = corpus.length;
        var reviewed = results.length;

        els.resultsSummary.textContent =
            'You reviewed ' + reviewed + ' of ' + total + ' items. ' +
            accepted + ' accepted, ' + rejected + ' rejected.';

        // Update issue link
        var params = new URLSearchParams({
            template: 'validation-report.md',
            labels: 'validation report',
            title: '[Validation Report] ' + sessionId
        });
        els.issueLink.href = GITHUB_ISSUE_BASE + '?' + params.toString();
    }

    // Validation flow
    function loadItem() {
        if (currentIndex >= corpus.length) {
            endSession();
            return;
        }

        var item = corpus[currentIndex];

        // Image
        var imageSrc = null;
        if (item.image_file) {
            // Prefer local downloaded image
            imageSrc = '../corpus-construction/' + item.image_file;
        } else if (item.image_url) {
            imageSrc = item.image_url;
        }

        if (imageSrc) {
            els.image.src = imageSrc;
            els.image.alt = item.observed_alt || '';
            els.image.style.display = '';
            hide(els.placeholder);
            // Remove any previously rendered inline SVG
            var oldSvg = document.querySelector('.card-image .inline-svg');
            if (oldSvg) oldSvg.remove();
        } else if (item.element_html && item.element_html.indexOf('<svg') !== -1) {
            // Render the inline SVG from element_html
            els.image.style.display = 'none';
            hide(els.placeholder);
            var oldSvg = document.querySelector('.card-image .inline-svg');
            if (oldSvg) oldSvg.remove();
            var svgMatch = item.element_html.match(/<svg[\s\S]*<\/svg>/);
            if (svgMatch) {
                var wrapper = document.createElement('div');
                wrapper.className = 'inline-svg';
                wrapper.setAttribute('role', 'img');
                wrapper.setAttribute('aria-label',
                    item.observed_alt || '');
                wrapper.innerHTML = svgMatch[0];
                document.querySelector('.card-image').appendChild(wrapper);
            }
        } else {
            els.image.src = '';
            els.image.alt = '';
            els.image.style.display = 'none';
            hide(els.placeholder);
            var oldSvg = document.querySelector('.card-image .inline-svg');
            if (oldSvg) oldSvg.remove();
            show(els.placeholder);
        }

        // Alt text display
        var altDisplay = item.observed_alt;
        if (altDisplay === '' || altDisplay === null) {
            altDisplay = '(empty alt text)';
        }
        els.altText.textContent = altDisplay;

        // Context
        els.contextPage.textContent = item.page_url || 'Unknown';
        els.contextRole.textContent = item.element_role || 'Unknown';
        els.contextSurrounding.textContent =
            item.surrounding_text || '(none)';

        // Reset decision UI
        resetDecisionUI();
        updateProgress();
    }

    function choose(decision) {
        pendingDecision = decision;

        // Update label based on decision
        if (decision === 'accepted') {
            els.reasonLabel.textContent = 'Reason for accepting';
        } else {
            els.reasonLabel.textContent = 'Reason for rejecting';
        }
        els.reasonHint.textContent = 'Optional.';

        // Show reason group
        show(els.reasonGroup);

        // Disable decision buttons while entering reason
        els.acceptBtn.disabled = true;
        els.rejectBtn.disabled = true;

        // Focus the textarea
        els.reasonInput.focus();
    }

    function submitReason() {
        var reason = els.reasonInput.value.trim();

        results.push({
            id: corpus[currentIndex].id,
            status: pendingDecision,
            reason: reason || null,
            timestamp: new Date().toISOString()
        });

        // Advance
        pendingDecision = null;
        els.reasonInput.value = '';
        currentIndex++;
        loadItem();
    }

    function cancelReason() {
        pendingDecision = null;
        els.reasonInput.value = '';
        els.reasonInput.removeAttribute('aria-invalid');
        resetDecisionUI();
        els.acceptBtn.focus();
    }

    function resetDecisionUI() {
        hide(els.reasonGroup);
        els.acceptBtn.disabled = false;
        els.rejectBtn.disabled = false;
    }

    // Progress
    function updateProgress() {
        var reviewed = Math.min(currentIndex, corpus.length);
        els.progressCount.textContent = reviewed;
        var pct = corpus.length > 0
            ? Math.round((reviewed / corpus.length) * 100)
            : 0;
        els.progressFill.style.width = pct + '%';
        els.progressBar.setAttribute('aria-valuenow', pct);
    }

    // Results export
    function downloadResults() {
        var data = {
            session_id: sessionId,
            timestamp: new Date().toISOString(),
            corpus_size: corpus.length,
            reviewed: results.length,
            accepted: results.filter(function (r) { return r.status === 'accepted'; }).length,
            rejected: results.filter(function (r) { return r.status === 'rejected'; }).length,
            results: results
        };

        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url;
        a.download = 'validation-' + sessionId + '.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    // Helpers
    function show(el) {
        if (typeof el === 'string') el = document.getElementById(el);
        el.classList.remove('hidden');
    }

    function hide(el) {
        if (typeof el === 'string') el = document.getElementById(el);
        el.classList.add('hidden');
    }

    // Boot
    document.addEventListener('DOMContentLoaded', init);
})();