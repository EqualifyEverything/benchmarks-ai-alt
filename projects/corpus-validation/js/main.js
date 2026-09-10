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
    let loadToken = 0; // guards a slow image load against a moved-on card

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
        els.overlay = document.getElementById('region-overlay');
        els.regionNote = document.getElementById('region-note');
        els.placeholder = document.getElementById('image-placeholder');
        els.altText = document.getElementById('current-alt');
        els.altSource = document.getElementById('current-alt-source');
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
        els.contextAlt = document.getElementById('context-alt');
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

    // The text under review, in the order a browser resolves it.
    function announcedName(item) {
        if (typeof item.accessible_name === 'string'
            && item.accessible_name !== '') {
            return item.accessible_name;
        }
        return item.observed_alt || '';
    }

    var SOURCE_LABELS = {
        'alt': "the image's alt attribute",
        'aria-label': 'an aria-label',
        'aria-labelledby': 'an aria-labelledby reference',
        'title': 'a title attribute',
        'svg-title': 'a title inside the SVG',
        'control-text': "the link or button's own text"
    };

    function sourceLabel(item) {
        return SOURCE_LABELS[item.accessible_name_source]
            || 'text in the markup';
    }

    // Whether the image itself carries alt text, separately from whatever the
    // surrounding control contributes.
    function altAttributeLabel(item) {
        if (item.observed_alt === null || item.observed_alt === undefined) {
            return '(no alt attribute on the image)';
        }
        if (item.observed_alt === '') {
            return '(alt="", deliberately empty)';
        }
        return item.observed_alt;
    }

    // An <area> is one clickable region of an image map, but the archived image
    // is the whole map, because that is the file the browser downloads. Showing
    // it alone asks a reviewer to judge "Northeast Michigan" against a national
    // forecast chart. So draw the region the alt text actually labels.
    //
    // The coordinates are CSS pixels of the map as its own page rendered it,
    // which is not the archived file's size when the page shipped a smaller
    // width. weather.gov/forecastmaps puts width="370" on a 512-pixel-wide map,
    // so measuring against the file would place the region a third too far
    // right. harvest.mjs records that rendered size as image_coord_space, and
    // the overlay's viewBox uses it, falling back to the file's own dimensions
    // when the markup stated none. Either way the browser scales the outline
    // with the image and no arithmetic is needed here.
    function parseRegion(item) {
        if (item.element_role !== 'area' || !item.element_html) return null;
        var coords = item.element_html.match(/coords\s*=\s*"([^"]*)"/i);
        if (!coords) return null;
        var nums = coords[1].split(/[\s,]+/).map(Number).filter(function (n) {
            return !isNaN(n);
        });
        if (nums.length < 3) return null;
        var shape = item.element_html.match(/shape\s*=\s*"([^"]*)"/i);
        var space = /^(\d+)x(\d+)$/.exec(item.image_coord_space || '');
        return {
            shape: shape ? shape[1].trim().toLowerCase() : 'rect',
            coords: nums,
            width: space ? Number(space[1]) : null,
            height: space ? Number(space[2]) : null
        };
    }

    // One SVG shape plus its bounding box, so the note can say where it sits.
    function regionShape(region) {
        var c = region.coords;

        if (region.shape === 'circle') {
            return {
                tag: 'circle',
                attrs: { cx: c[0], cy: c[1], r: c[2] },
                box: [c[0] - c[2], c[1] - c[2], c[0] + c[2], c[1] + c[2]]
            };
        }

        if (region.shape === 'poly' || region.shape === 'polygon') {
            var points = [];
            var xs = [];
            var ys = [];
            for (var i = 0; i + 1 < c.length; i += 2) {
                points.push(c[i] + ',' + c[i + 1]);
                xs.push(c[i]);
                ys.push(c[i + 1]);
            }
            if (points.length < 3) return null;
            return {
                tag: 'polygon',
                attrs: { points: points.join(' ') },
                corners: points.length,
                box: [Math.min.apply(null, xs), Math.min.apply(null, ys),
                    Math.max.apply(null, xs), Math.max.apply(null, ys)]
            };
        }

        // rect, and anything unrecognised: left, top, right, bottom.
        if (c.length < 4) return null;
        var x1 = Math.min(c[0], c[2]);
        var y1 = Math.min(c[1], c[3]);
        var x2 = Math.max(c[0], c[2]);
        var y2 = Math.max(c[1], c[3]);
        return {
            tag: 'rect',
            attrs: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
            box: [x1, y1, x2, y2]
        };
    }

    var BANDS = ['top', 'middle', 'bottom'];
    var COLUMNS = ['left', 'centre', 'right'];

    function band(value, extent, names) {
        var i = Math.floor((value / extent) * 3);
        return names[Math.max(0, Math.min(2, i))];
    }

    // The outline says nothing to someone who cannot see it, so say the same
    // thing in words. Accessibility is the point of the whole corpus.
    function regionNote(shape, width, height) {
        var b = shape.box;
        var where = band((b[1] + b[3]) / 2, height, BANDS) + ' ' +
            band((b[0] + b[2]) / 2, width, COLUMNS);
        var what = shape.corners
            ? 'a ' + shape.corners + '-point outline'
            : 'an outlined ' + shape.tag;
        return 'This is one clickable region of an image map. The whole map is '
            + 'shown above; the text under review labels only ' + what + ' in '
            + 'the ' + where + ' of it, spanning x ' + Math.round(b[0])
            + ' to ' + Math.round(b[2]) + ' and y ' + Math.round(b[1])
            + ' to ' + Math.round(b[3]) + " of the map's " + width + ' by '
            + height + ' coordinate space. Judge the text against that region, '
            + 'not the map.';
    }

    function svgNode(tag, attrs, className) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (var name in attrs) {
            if (Object.prototype.hasOwnProperty.call(attrs, name)) {
                el.setAttribute(name, attrs[name]);
            }
        }
        el.setAttribute('class', className);
        return el;
    }

    function clearRegion() {
        els.overlay.textContent = '';
        hide(els.overlay);
        els.regionNote.textContent = '';
        hide(els.regionNote);
    }

    function drawRegion(region, width, height) {
        var shape = regionShape(region);
        if (!shape || !width || !height) {
            clearRegion();
            return;
        }
        els.overlay.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        els.overlay.textContent = '';
        // Two identical shapes: a dark stroke beneath a light one, so the
        // outline stays visible over any part of any map.
        els.overlay.appendChild(svgNode(shape.tag, shape.attrs,
            'region-under'));
        els.overlay.appendChild(svgNode(shape.tag, shape.attrs, 'region-over'));
        show(els.overlay);
        els.regionNote.textContent = regionNote(shape, width, height);
        show(els.regionNote);
    }

    // Natural dimensions are only known once the bytes arrive. loadItem has
    // already bumped the token, so a load that finishes after the reviewer has
    // moved on finds a stale one and does nothing.
    function drawRegionWhenSized(region) {
        if (region.width && region.height) {
            drawRegion(region, region.width, region.height);
            return;
        }
        var token = loadToken;
        var draw = function () {
            if (token !== loadToken) return;
            drawRegion(region, els.image.naturalWidth,
                els.image.naturalHeight);
        };
        if (els.image.complete && els.image.naturalWidth) draw();
        else els.image.addEventListener('load', draw, { once: true });
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

        // What a screen reader actually announces. For many items the text
        // lives on the link or button rather than on the image itself, so
        // observed_alt alone would show nothing to judge.
        var announced = announcedName(item);

        // Anything left over from the previous card, before the new one is
        // drawn: a stale outline on an unrelated image is worse than none.
        loadToken++;
        clearRegion();
        var region = parseRegion(item);

        if (imageSrc) {
            els.image.src = imageSrc;
            els.image.alt = announced;
            els.image.style.display = '';
            hide(els.placeholder);
            // Remove any previously rendered inline SVG
            var oldSvg = document.querySelector('.card-image .inline-svg');
            if (oldSvg) oldSvg.remove();
            if (region) drawRegionWhenSized(region);
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
                wrapper.setAttribute('aria-label', announced);
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
        els.altText.textContent = announced || '(no text at all)';
        if (els.altSource) {
            els.altSource.textContent = announced
                ? 'Written in the page as ' + sourceLabel(item) + '.'
                : '';
        }

        // Context
        els.contextPage.textContent = item.page_url || 'Unknown';
        els.contextRole.textContent = item.element_role || 'Unknown';
        if (els.contextAlt) {
            els.contextAlt.textContent = altAttributeLabel(item);
        }
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

        // The anchor has to be in the document for the click to count, and the
        // object URL has to outlive the click long enough for the browser to
        // read the blob. Revoking on the same tick cancels the download.
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
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