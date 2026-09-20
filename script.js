(function(){

  "use strict";

  // ---------- element refs ----------
  var editor = document.getElementById('editor');
  var preview = document.getElementById('preview');
  var charCount = document.getElementById('charCount');
  var statWords = document.getElementById('statWords');
  var statChars = document.getElementById('statChars');
  var statTime = document.getElementById('statTime');
  var toastEl = document.getElementById('toast');

  var fontSelect = document.getElementById('fontSelect');
  var sizeValue = document.getElementById('sizeValue');
  var sizeDown = document.getElementById('sizeDown');
  var sizeUp = document.getElementById('sizeUp');
  var swatchesWrap = document.getElementById('swatches');
  var viewRendered = document.getElementById('viewRendered');
  var viewRaw = document.getElementById('viewRaw');

  var copyBtn = document.getElementById('copyBtn');
  var exportBtn = document.getElementById('exportBtn');
  var exportMenu = document.getElementById('exportMenu');
  var downloadHtmlBtn = document.getElementById('downloadHtmlBtn');
  var downloadMdBtn = document.getElementById('downloadMdBtn');
  var downloadPngBtn = document.getElementById('downloadPngBtn');
  var printBtn = document.getElementById('printBtn');

  var urlImgBtn = document.getElementById('urlImgBtn');
  var urlImgMenu = document.getElementById('urlImgMenu');
  var urlImgInput = document.getElementById('urlImgInput');
  var urlImgFetch = document.getElementById('urlImgFetch');
  var urlImgResult = document.getElementById('urlImgResult');
  var urlImgPreview = document.getElementById('urlImgPreview');
  var urlImgInsert = document.getElementById('urlImgInsert');
  var urlImgDownload = document.getElementById('urlImgDownload');
  var urlImgError = document.getElementById('urlImgError');

  var pasteBtn = document.getElementById('pasteBtn');
  var importBtn = document.getElementById('importBtn');
  var fileInput = document.getElementById('fileInput');
  var sampleBtn = document.getElementById('sampleBtn');
  var clearBtn = document.getElementById('clearBtn');

  // ---------- state ----------
  var state = {
    fontSize: 17,
    color: '#f3f1f6',
    font: fontSelect.value,
    fetchedBlob: null,
    fetchedFilename: 'image',
    fetchedSourceUrl: ''
  };

  var COLORS = ['#f3f1f6', '#8f9dff', '#e08a8a', '#7ecf9e', '#e0b979', '#c79cf0'];

  // ---------- core regex markdown parser ----------
  // Converts a Markdown string to an HTML string using pattern matching only —
  // no external parsing library. Code spans/blocks are pulled out first and
  // swapped back in at the end so the regex passes below never mangle them.
  function convertMarkdown(src){
    if(!src) return '';

    var html = String(src);

    // 1. Escape raw HTML so user text can't break the page.
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 2. Pull out fenced code blocks ```...``` so nothing inside them gets
    //    touched by the inline rules below.
    var codeBlocks = [];
    html = html.replace(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g, function(_, lang, code){
      codeBlocks.push(code.replace(/\n$/, ''));
      return '\u0000BLOCK' + (codeBlocks.length - 1) + '\u0000';
    });

    // 3. Pull out inline code spans `code` the same way.
    var inlineCode = [];
    html = html.replace(/`([^`\n]+)`/g, function(_, code){
      inlineCode.push(code);
      return '\u0000SPAN' + (inlineCode.length - 1) + '\u0000';
    });

    // 4. Images: ![alt](url) — must run before the link rule, since a link
    //    pattern would otherwise also match the "[alt](url)" part of it.
    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function(_, alt, url, title){
      return '<img src="' + url + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>';
    });

    // 5. Links: [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function(_, text, url, title){
      return '<a href="' + url + '"' + (title ? ' title="' + title + '"' : '') + ' target="_blank" rel="noopener noreferrer">' + text + '</a>';
    });

    // 6. Headings: ###, ##, # (longest prefix first so "### x" doesn't also
    //    trip the "#" rule).
    html = html.replace(/^### +(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## +(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# +(.+)$/gm, '<h1>$1</h1>');

    // 7. Blockquotes: group consecutive "> text" lines into one <blockquote>.
    html = html.replace(/(?:^&gt; ?.*(?:\n|$))+/gm, function(block){
      var lines = block.split('\n').filter(function(l){ return l.length; })
        .map(function(l){ return l.replace(/^&gt; ?/, ''); });
      return '<blockquote>' + lines.join('<br>') + '</blockquote>\n';
    });

    // 8. Bold: **text** or __text__ — run before italics so "**x**" isn't
    //    first split up by the single */_ rule.
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

    // 9. Italic: *text* or _text_
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');

    // 10. Simple unordered lists ("- item" lines).
    html = html.replace(/(?:^- .*(?:\n|$))+/gm, function(block){
      var items = block.split('\n').filter(function(l){ return l.length; })
        .map(function(l){ return '<li>' + l.replace(/^- /, '') + '</li>'; });
      return '<ul>' + items.join('') + '</ul>\n';
    });

    // 11. Drop the placeholders back in.
    html = html.replace(/\u0000SPAN(\d+)\u0000/g, function(_, i){ return '<code>' + inlineCode[+i] + '</code>'; });
    html = html.replace(/\u0000BLOCK(\d+)\u0000/g, function(_, i){ return '<pre><code>' + codeBlocks[+i] + '</code></pre>'; });

    // 12. Wrap remaining loose lines in paragraphs, leaving block-level
    //     elements (headings, lists, blockquotes, images, code) untouched.
    var blockTag = /^\s*<(h1|h2|h3|ul|ol|blockquote|pre|img)/;
    html = html.split(/\n{2,}/).map(function(chunk){
      var trimmed = chunk.trim();
      if(!trimmed) return '';
      if(blockTag.test(trimmed)) return trimmed;
      return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>';
    }).filter(Boolean).join('\n');

    return html;
  }

  function mdToHtml(src){
    return convertMarkdown(src);
  }

  // ---------- helpers ----------
  function toast(msg, isError){
    toastEl.textContent = msg;
    toastEl.style.background = isError ? '#f3d9d9' : 'rgba(255,255,255,0.85)';
    toastEl.style.color = isError ? '#7a2323' : '#1b1c1e';
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ toastEl.classList.remove('show'); }, 2400);
  }

  function closeAllMenus(except){
    [exportMenu, urlImgMenu].forEach(function(m){
      if(m !== except){ m.classList.remove('open'); }
    });
    exportBtn.setAttribute('aria-expanded', exportMenu.classList.contains('open'));
    urlImgBtn.setAttribute('aria-expanded', urlImgMenu.classList.contains('open'));
  }

  function download(filename, blobOrString, mime){
    var blob = blobOrString instanceof Blob ? blobOrString : new Blob([blobOrString], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
  }

  function renderedHtmlFragment(){
    return mdToHtml(editor.value || '');
  }

  function fullStandaloneHtml(){
    var body = renderedHtmlFragment();
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Document</title>\n<style>\n  body{ font-family:' + state.font + '; font-size:' + state.fontSize + 'px; color:' + state.color + '; max-width:760px; margin:2.5rem auto; padding:0 1.5rem; line-height:1.65; }\n  img{ max-width:100%; border-radius:8px; }\n  pre{ background:#f1f1f1; padding:0.8rem 1rem; border-radius:8px; overflow-x:auto; }\n  code{ font-family: "JetBrains Mono", monospace; font-size:0.85em; }\n  blockquote{ margin:0; padding-left:1rem; border-left:3px solid #c6d3ea; color:#5b5d63; }\n  table{ border-collapse:collapse; width:100%; }\n  th, td{ border:1px solid #ddd; padding:0.4rem 0.6rem; }\n</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>';
  }

  // ---------- markdown rendering & stats ----------
  function renderPreview(){
    if(viewRaw.getAttribute('aria-pressed') === 'true'){
      preview.textContent = fullStandaloneHtml();
    } else {
      preview.innerHTML = renderedHtmlFragment();
    }
    applyPreviewStyle();
  }

  function applyPreviewStyle(){
    preview.style.fontFamily = state.font;
    preview.style.fontSize = state.fontSize + 'px';
    preview.style.color = state.color;
  }

  function updateStats(){
    var text = editor.value || '';
    var words = text.trim().length ? text.trim().split(/\s+/).length : 0;
    var chars = text.length;
    var minutes = Math.max(1, Math.round(words / 200));
    statWords.textContent = words;
    statChars.textContent = chars;
    statTime.textContent = (words === 0 ? '0' : minutes) + ' min';
    charCount.textContent = chars + ' chars';
  }

  function onEditorChange(){
    updateStats();
    renderPreview();
  }

  // ---------- toolbar wiring ----------
  fontSelect.addEventListener('change', function(){
    state.font = fontSelect.value;
    applyPreviewStyle();
  });

  sizeDown.addEventListener('click', function(){
    state.fontSize = Math.max(11, state.fontSize - 1);
    sizeValue.textContent = state.fontSize + 'px';
    applyPreviewStyle();
  });
  sizeUp.addEventListener('click', function(){
    state.fontSize = Math.min(28, state.fontSize + 1);
    sizeValue.textContent = state.fontSize + 'px';
    applyPreviewStyle();
  });

  COLORS.forEach(function(c, i){
    var sw = document.createElement('div');
    sw.className = 'swatch' + (i === 0 ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', function(){
      state.color = c;
      Array.prototype.forEach.call(swatchesWrap.children, function(el){ el.classList.remove('active'); });
      sw.classList.add('active');
      applyPreviewStyle();
    });
    swatchesWrap.appendChild(sw);
  });

  viewRendered.addEventListener('click', function(){
    viewRendered.setAttribute('aria-pressed', 'true');
    viewRaw.setAttribute('aria-pressed', 'false');
    preview.classList.remove('raw');
    renderPreview();
  });
  viewRaw.addEventListener('click', function(){
    viewRaw.setAttribute('aria-pressed', 'true');
    viewRendered.setAttribute('aria-pressed', 'false');
    preview.classList.add('raw');
    renderPreview();
  });

  sampleBtn.addEventListener('click', function(){
    editor.value = [
      '# Markformer',
      '',
      'Type **Markdown** on the left, see the *rendered* result on the right.',
      '',
      '## Features',
      '- Live preview',
      '- Adjustable font, size and color',
      '- Export to HTML, Markdown, PNG or PDF',
      '- Pull an image in from any URL and drop it straight into your document',
      '',
      '> Fetch an image from any site with the URL → Image button above, then insert it right where your cursor is.',
      '',
      '```js',
      'console.log("code blocks work too");',
      '```',
      '',
      '[Learn more about Markdown](https://www.markdownguide.org)'
    ].join('\n');
    onEditorChange();
    toast('Sample loaded');
  });

  clearBtn.addEventListener('click', function(){
    editor.value = '';
    onEditorChange();
    toast('Cleared');
  });

  editor.addEventListener('input', onEditorChange);

  // ---------- copy / export ----------
  copyBtn.addEventListener('click', function(){
    var html = renderedHtmlFragment();
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(html).then(function(){
        toast('HTML copied to clipboard');
      }, function(){
        toast('Copy failed — try selecting manually', true);
      });
    } else {
      toast('Clipboard not available in this browser', true);
    }
  });

  exportBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var willOpen = !exportMenu.classList.contains('open');
    closeAllMenus();
    if(willOpen){ exportMenu.classList.add('open'); }
    exportBtn.setAttribute('aria-expanded', willOpen);
  });

  downloadHtmlBtn.addEventListener('click', function(){
    download('document.html', fullStandaloneHtml(), 'text/html');
    toast('HTML downloaded');
    closeAllMenus();
  });

  downloadMdBtn.addEventListener('click', function(){
    download('document.md', editor.value || '', 'text/markdown');
    toast('Markdown downloaded');
    closeAllMenus();
  });

  downloadPngBtn.addEventListener('click', function(){
    closeAllMenus();
    toast('Rendering image…');
    var wasRaw = viewRaw.getAttribute('aria-pressed') === 'true';
    if(wasRaw){ viewRendered.click(); }
    html2canvas(preview, { backgroundColor: '#23212c', scale: 2, useCORS: true }).then(function(canvas){
      canvas.toBlob(function(blob){
        if(blob){
          download('preview.png', blob, 'image/png');
          toast('Image saved');
        } else {
          toast('Could not generate image', true);
        }
      });
    }).catch(function(){
      toast('Could not generate image — some fetched images may block canvas export', true);
    });
  });

  printBtn.addEventListener('click', function(){
    closeAllMenus();
    var wasRaw = viewRaw.getAttribute('aria-pressed') === 'true';
    if(wasRaw){ viewRendered.click(); }
    setTimeout(function(){ window.print(); }, 50);
  });

  // ---------- import ----------
  // ---------- paste from clipboard ----------
  pasteBtn.addEventListener('click', function(){
    if(!navigator.clipboard || !navigator.clipboard.readText){
      toast('Clipboard access isn\u2019t available in this browser', true);
      return;
    }
    navigator.clipboard.readText().then(function(text){
      if(!text){ toast('Clipboard is empty', true); return; }
      var start = editor.selectionStart != null ? editor.selectionStart : editor.value.length;
      var end = editor.selectionEnd != null ? editor.selectionEnd : editor.value.length;
      editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + text.length;
      editor.focus();
      onEditorChange();
      toast('Pasted from clipboard');
    }).catch(function(){
      toast('Couldn\u2019t read the clipboard — check browser permissions', true);
    });
  });

  importBtn.addEventListener('click', function(){ fileInput.click(); });
  fileInput.addEventListener('change', function(){
    var file = fileInput.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      editor.value = reader.result;
      onEditorChange();
      toast('Imported ' + file.name);
    };
    reader.onerror = function(){ toast('Could not read that file', true); };
    reader.readAsText(file);
    fileInput.value = '';
  });

  // ---------- URL → Image (works on images from any site) ----------
  // Direct fetch is tried first (works when the host sends permissive CORS
  // headers). If that fails — the common case for most sites — we fall back
  // to a read-only image proxy that fetches the bytes server-side and
  // re-serves them with CORS enabled, so hotlink-protected or CORS-locked
  // images still come through.
  function proxiedUrl(rawUrl){
    return 'https://images.weserv.nl/?url=' + encodeURIComponent(rawUrl.replace(/^https?:\/\//, ''));
  }
  function fallbackProxiedUrl(rawUrl){
    return 'https://corsproxy.io/?url=' + encodeURIComponent(rawUrl);
  }

  function fetchAsBlob(rawUrl){
    function tryFetch(u){
      return fetch(u, { mode: 'cors', referrerPolicy: 'no-referrer' }).then(function(res){
        if(!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      });
    }
    return tryFetch(rawUrl).catch(function(){
      return tryFetch(proxiedUrl(rawUrl));
    }).catch(function(){
      return tryFetch(fallbackProxiedUrl(rawUrl));
    });
  }

  function guessFilename(rawUrl, blob){
    var name = 'image';
    try{
      var path = new URL(rawUrl).pathname;
      var base = path.split('/').pop();
      if(base && base.indexOf('.') > -1){ name = base; }
    }catch(e){ /* not a valid URL — leave default */ }
    if(name.indexOf('.') === -1){
      var ext = (blob.type.split('/')[1] || 'png').split('+')[0];
      name += '.' + ext;
    }
    return name;
  }

  urlImgBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var willOpen = !urlImgMenu.classList.contains('open');
    closeAllMenus();
    if(willOpen){ urlImgMenu.classList.add('open'); urlImgInput.focus(); }
    urlImgBtn.setAttribute('aria-expanded', willOpen);
  });

  function resetUrlImgResult(){
    urlImgResult.hidden = true;
    urlImgError.hidden = true;
    state.fetchedBlob = null;
  }

  urlImgFetch.addEventListener('click', function(){
    var raw = urlImgInput.value.trim();
    urlImgError.hidden = true;
    urlImgResult.hidden = true;

    if(!raw){ urlImgError.textContent = 'Paste an image URL first.'; urlImgError.hidden = false; return; }
    var parsed;
    try{ parsed = new URL(raw); if(!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol'); }
    catch(e){ urlImgError.textContent = 'That doesn\u2019t look like a valid http(s) URL.'; urlImgError.hidden = false; return; }

    urlImgFetch.disabled = true;
    var originalLabel = urlImgFetch.textContent;
    urlImgFetch.innerHTML = '<span class="spinner"></span>Fetching…';

    fetchAsBlob(raw).then(function(blob){
      if(blob.type && blob.type.indexOf('image/') !== 0){
        throw new Error('not-an-image');
      }
      state.fetchedBlob = blob;
      state.fetchedSourceUrl = raw;
      state.fetchedFilename = guessFilename(raw, blob);
      var objUrl = URL.createObjectURL(blob);
      urlImgPreview.src = objUrl;
      urlImgResult.hidden = false;
      toast('Image fetched');
    }).catch(function(err){
      var msg = (err && err.message === 'not-an-image')
        ? 'That URL didn\u2019t return an image file.'
        : 'Couldn\u2019t fetch that image — the site may be blocking access.';
      urlImgError.textContent = msg;
      urlImgError.hidden = false;
    }).finally(function(){
      urlImgFetch.disabled = false;
      urlImgFetch.textContent = originalLabel;
    });
  });

  urlImgInput.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); urlImgFetch.click(); }
  });

  urlImgInsert.addEventListener('click', function(){
    if(!state.fetchedBlob) return;
    var reader = new FileReader();
    reader.onload = function(){
      var dataUri = reader.result; // base64 data URI — always renders, regardless of hotlink protection
      var alt = state.fetchedFilename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') || 'image';
      var snippet = '![' + alt + '](' + dataUri + ')\n';
      var start = editor.selectionStart != null ? editor.selectionStart : editor.value.length;
      var end = editor.selectionEnd != null ? editor.selectionEnd : editor.value.length;
      editor.value = editor.value.slice(0, start) + snippet + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + snippet.length;
      editor.focus();
      onEditorChange();
      toast('Image inserted into document');
      closeAllMenus();
    };
    reader.onerror = function(){ toast('Could not embed that image', true); };
    reader.readAsDataURL(state.fetchedBlob);
  });

  urlImgDownload.addEventListener('click', function(){
    if(!state.fetchedBlob) return;
    download(state.fetchedFilename, state.fetchedBlob);
    toast('Image downloaded');
  });

  urlImgInput.addEventListener('input', resetUrlImgResult);

  // ---------- global click-away for menus ----------
  document.addEventListener('click', function(e){
    if(!exportMenu.contains(e.target) && e.target !== exportBtn){
      exportMenu.classList.remove('open');
      exportBtn.setAttribute('aria-expanded', 'false');
    }
    if(!urlImgMenu.contains(e.target) && e.target !== urlImgBtn){
      urlImgMenu.classList.remove('open');
      urlImgBtn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ closeAllMenus(); }
  });

  // ---------- init ----------
  sampleBtn.click();
})();
