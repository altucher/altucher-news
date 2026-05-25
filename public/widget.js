(function() {
  'use strict';

  // Configuration
  var BLUETAO_URL = 'https://bluetao.ai';
  var WIDGET_ID = 'bluetao-chat-widget';
  var IFRAME_ID = 'bluetao-chat-iframe';
  var BUTTON_ID = 'bluetao-chat-button';

  // Check if already loaded
  if (document.getElementById(WIDGET_ID)) {
    return;
  }

  // Create container
  var container = document.createElement('div');
  container.id = WIDGET_ID;
  container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: system-ui, -apple-system, sans-serif;';
  document.body.appendChild(container);

  // State
  var isOpen = false;
  var iframe = null;

  // Create chat button
  function createButton() {
    var button = document.createElement('button');
    button.id = BUTTON_ID;
    button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    button.style.cssText = 'width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); box-shadow: 0 4px 20px rgba(245, 158, 11, 0.4); display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s;';
    button.onmouseover = function() {
      button.style.transform = 'scale(1.05)';
      button.style.boxShadow = '0 6px 25px rgba(245, 158, 11, 0.5)';
    };
    button.onmouseout = function() {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 4px 20px rgba(245, 158, 11, 0.4)';
    };
    button.onclick = toggleChat;
    container.appendChild(button);
  }

  // Create iframe
  function createIframe() {
    iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = BLUETAO_URL + '/embed';
    iframe.style.cssText = 'width: 400px; height: 550px; border: none; border-radius: 16px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3); display: none; background: #1a1612;';
    iframe.allow = 'clipboard-write';
    container.insertBefore(iframe, container.firstChild);
  }

  // Toggle chat visibility
  function toggleChat() {
    isOpen = !isOpen;
    var button = document.getElementById(BUTTON_ID);
    
    if (isOpen) {
      if (!iframe) {
        createIframe();
      }
      iframe.style.display = 'block';
      button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6l12 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else {
      if (iframe) {
        iframe.style.display = 'none';
      }
      button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
  }

  // Listen for messages from iframe
  window.addEventListener('message', function(event) {
    if (event.origin !== BLUETAO_URL) return;
    
    if (event.data && event.data.type === 'bluetao-close') {
      isOpen = false;
      if (iframe) iframe.style.display = 'none';
      var button = document.getElementById(BUTTON_ID);
      if (button) {
        button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
    }
  });

  // Mobile responsiveness
  function checkMobile() {
    if (iframe && window.innerWidth < 500) {
      iframe.style.width = 'calc(100vw - 40px)';
      iframe.style.height = 'calc(100vh - 100px)';
      iframe.style.position = 'fixed';
      iframe.style.bottom = '80px';
      iframe.style.right = '20px';
    } else if (iframe) {
      iframe.style.width = '400px';
      iframe.style.height = '550px';
      iframe.style.position = 'static';
    }
  }

  window.addEventListener('resize', checkMobile);

  // Initialize
  createButton();
  
  // Expose API
  window.BlueTAO = {
    open: function() { if (!isOpen) toggleChat(); },
    close: function() { if (isOpen) toggleChat(); },
    toggle: toggleChat
  };
})();
