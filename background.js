// Background service worker for FPTU Study Calendar Exporter

const FAP_BASE_URL = 'https://fap.fpt.edu.vn';
const TIMETABLE_URL = 'https://fap.fpt.edu.vn/Report/ScheduleOfWeek.aspx';
const LOGIN_CHECK_SELECTOR = '#ctl00_divUser';
const MAX_RETRIES = 3;
const LOGIN_CACHE_KEY = 'fptu_calendar_login_state';
const LOGIN_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
const FIRST_RUN_COMPLETED_KEY = 'fptu_calendar_first_run_completed';

// Log when service worker starts
console.log('FPTU Study Calendar Exporter: Background service worker loaded');

// Get cached login state
async function getCachedLoginState() {
  try {
    const cached = await chrome.storage.local.get(LOGIN_CACHE_KEY);
    if (cached[LOGIN_CACHE_KEY]) {
      const { isLoggedIn, timestamp } = cached[LOGIN_CACHE_KEY];
      const now = Date.now();
      // Check if cache is still valid (within 30 minutes)
      if (now - timestamp < LOGIN_CACHE_DURATION) {
        console.log('Using cached login state:', isLoggedIn);
        return isLoggedIn;
      } else {
        console.log('Login cache expired, will re-check');
      }
    }
    return null; // No valid cache
  } catch (error) {
    console.error('Error getting cached login state:', error);
    return null;
  }
}

// Save login state to cache
async function saveLoginStateToCache(isLoggedIn) {
  try {
    await chrome.storage.local.set({
      [LOGIN_CACHE_KEY]: {
        isLoggedIn,
        timestamp: Date.now()
      }
    });
    console.log('Saved login state to cache:', isLoggedIn);
  } catch (error) {
    console.error('Error saving login state to cache:', error);
  }
}

// Invalidate login cache (e.g., when navigation fails, user might have logged out)
async function invalidateLoginCache() {
  try {
    await chrome.storage.local.remove(LOGIN_CACHE_KEY);
    console.log('Invalidated login cache');
  } catch (error) {
    console.error('Error invalidating login cache:', error);
  }
}

// Check if this is the first run
async function isFirstRun() {
  try {
    const result = await chrome.storage.local.get(FIRST_RUN_COMPLETED_KEY);
    return !result[FIRST_RUN_COMPLETED_KEY];
  } catch (error) {
    console.error('Error checking first run status:', error);
    // On error, assume it's not first run to avoid forcing login check unnecessarily
    return false;
  }
}

// Mark first run as completed
async function markFirstRunCompleted() {
  try {
    await chrome.storage.local.set({ [FIRST_RUN_COMPLETED_KEY]: true });
    console.log('Marked first run as completed');
  } catch (error) {
    console.error('Error marking first run as completed:', error);
  }
}

// Reset first run flag (called on install/reload)
async function resetFirstRunFlag() {
  try {
    await chrome.storage.local.remove(FIRST_RUN_COMPLETED_KEY);
    console.log('Reset first run flag');
  } catch (error) {
    console.error('Error resetting first run flag:', error);
  }
}

// Check if already on timetable page
async function isOnTimetablePage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Check if URL matches timetable page and has student info element
        const isCorrectUrl = window.location.href === 'https://fap.fpt.edu.vn/Report/ScheduleOfWeek.aspx';
        const hasStudentInfo = document.querySelector('#ctl00_mainContent_lblStudent') !== null;
        // Also check that we're NOT on login page (in case of redirect)
        const isLoginPage = document.querySelector('#ctl00_mainContent_btnLogin') !== null;
        return isCorrectUrl && hasStudentInfo && !isLoginPage;
      }
    });
    return results[0].result;
  } catch (error) {
    console.error('Error checking if on timetable page:', error);
    return false;
  }
}

// Find existing FAP tab (login page or timetable page)
async function findExistingFAPTab() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://fap.fpt.edu.vn/*'] });
    
    // Look for timetable page first (preferred)
    for (const tab of tabs) {
      if (tab.url && tab.url.includes('ScheduleOfWeek.aspx')) {
        const isOnTimetable = await isOnTimetablePage(tab.id);
        if (isOnTimetable) {
          console.log('Found existing timetable tab:', tab.id);
          return tab;
        }
      }
    }
    
    // Look for any FAP tab (could be login page or other pages)
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith(FAP_BASE_URL)) {
        console.log('Found existing FAP tab:', tab.id, tab.url);
        return tab;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding existing FAP tab:', error);
    return null;
  }
}

// Check if user is logged in (with caching and proper page load waiting)
async function checkLogin(tabId, forceCheck = false) {
  try {
    // Check cache first unless forced
    if (!forceCheck) {
      const cachedState = await getCachedLoginState();
      if (cachedState !== null) {
        console.log('Using cached login state, skipping actual check');
        return cachedState;
      }
    }
    
    console.log('Performing actual login check on tab:', tabId);
    
    // Wait for page to fully load and DOM to be ready before checking
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return new Promise((resolve) => {
          if (document.readyState === 'complete') {
            // Wait a bit more for any dynamic content
            setTimeout(resolve, 500);
          } else {
            const checkReady = () => {
              if (document.readyState === 'complete') {
                setTimeout(resolve, 500);
              } else {
                setTimeout(checkReady, 100);
              }
            };
            checkReady();
          }
        });
      }
    });
    
    // Perform actual login check with retry
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Try to find the login indicator element
        const userDiv = document.querySelector('#ctl00_divUser');
        // Also check for common login page elements to ensure we're not on login page
        const loginForm = document.querySelector('#ctl00_mainContent_btnLogin');
        // If user div exists and we're not on login page, user is logged in
        return userDiv !== null && loginForm === null;
      }
    });
    const isLoggedIn = results[0].result;
    
    console.log('Login check result:', isLoggedIn);
    
    // Save to cache
    await saveLoginStateToCache(isLoggedIn);
    
    return isLoggedIn;
  } catch (error) {
    console.error('Error checking login:', error);
    // On error, invalidate cache to force re-check next time
    await invalidateLoginCache();
    return false;
  }
}

// Navigate to URL and wait for load
async function navigateToUrl(tabId, url, waitTime) {
  try {
    await chrome.tabs.update(tabId, { url });
    await new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, waitTime);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    return true;
  } catch (error) {
    console.error('Navigation error:', error);
    // Navigation failure might indicate user logged out, invalidate cache
    await invalidateLoginCache();
    return false;
  }
}

// Get current tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Parse date from DD/MM format
function parseDate(dateStr, year) {
  const [day, month] = dateStr.split('/').map(Number);
  return new Date(year, month - 1, day);
}

// Check if date is in range
function isDateInRange(date, startDate, endDate) {
  const d = new Date(date);
  const start = new Date(startDate);
  const end = new Date(endDate);
  return d >= start && d <= end;
}

// Check if week overlaps with date range
function weekOverlapsRange(weekStart, weekEnd, rangeStart, rangeEnd) {
  const weekStartDate = new Date(weekStart);
  const weekEndDate = new Date(weekEnd);
  const rangeStartDate = new Date(rangeStart);
  const rangeEndDate = new Date(rangeEnd);
  
  // Week overlaps if any day in week is in range
  return (weekStartDate <= rangeEndDate && weekEndDate >= rangeStartDate);
}

// Extract week information from dropdown
// Note: This function assumes the year dropdown is already set correctly
// It only reads the week options, it does NOT change the year dropdown
async function getWeekOptions(tabId) {
  try {
    // Just read the week options without changing the year
    // The year should already be set correctly before calling this function
    const weekResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const weekSelect = document.querySelector('#ctl00_mainContent_drpSelectWeek');
        if (!weekSelect) return [];
        
        const options = Array.from(weekSelect.options);
        return options.map(opt => ({
          value: opt.value,
          text: opt.text.trim()
        }));
      }
    });

    return weekResults[0].result || [];
  } catch (error) {
    console.error('Error getting week options:', error);
    return [];
  }
}

// Filter weeks by date range
function filterWeeksByRange(weekOptions, startDate, endDate, year) {
  const filtered = [];
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);
  
  for (const option of weekOptions) {
    // Parse week range from text like "12/01 To 18/01" or "30/12 To 05/01"
    const match = option.text.match(/(\d{2}\/\d{2})\s+To\s+(\d{2}\/\d{2})/);
    if (!match) continue;
    
    const weekStartStr = match[1];
    const weekEndStr = match[2];
    
    // Parse dates to determine which year they belong to
    const [startDay, startMonth] = weekStartStr.split('/').map(Number);
    const [endDay, endMonth] = weekEndStr.split('/').map(Number);
    
    // Determine year for week dates (handle year boundaries)
    // IMPORTANT: When year dropdown shows 2026 and week is "30/12 To 05/01",
    // it means Dec 30, 2025 to Jan 5, 2026 (the LAST week of 2025, shown at the start of 2026's dropdown)
    // When year dropdown shows 2026 and week is "05/01 To 11/01",
    // it means Jan 5, 2026 to Jan 11, 2026 (a week in 2026)
    
    let weekStartYear = year;
    let weekEndYear = year;
    
    // If week spans year boundary (e.g., 30/12 To 05/01)
    if (startMonth === 12 && endMonth === 1) {
      // Week starts in December of (year-1), ends in January of year
      // This is the last week of (year-1), shown at the start of year's dropdown
      weekStartYear = year - 1;
      weekEndYear = year;
    } else if (startMonth > endMonth) {
      // Week spans year boundary (e.g., November to January)
      weekStartYear = year - 1;
      weekEndYear = year;
    } else {
      // Week is within the same year (e.g., 05/01 To 11/01 in 2026 dropdown = Jan 2026)
      weekStartYear = year;
      weekEndYear = year;
    }
    
    const weekStartDate = parseDate(weekStartStr, weekStartYear);
    let weekEndDate = parseDate(weekEndStr, weekEndYear);
    
    // Verify the dates make sense
    if (weekEndDate < weekStartDate) {
      // This shouldn't happen, but if it does, adjust
      weekEndYear = weekStartYear + 1;
      weekEndDate = parseDate(weekEndStr, weekEndYear);
    }
    
    if (weekOverlapsRange(weekStartDate, weekEndDate, rangeStart, rangeEnd)) {
      filtered.push({
        value: option.value,
        text: option.text,
        startDate: weekStartDate.toISOString().split('T')[0],
        endDate: weekEndDate.toISOString().split('T')[0],
        startYear: weekStartYear,
        endYear: weekEndYear
      });
    }
  }
  
  return filtered;
}

// Extract data from current page
async function extractWeekData(tabId) {
  try {
    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    
    // Wait a bit for content script to execute
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Get the extracted data and also check what the content script found
    const dataResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Check if content script ran
        if (typeof window.scrapedData === 'undefined') {
          console.error('Content script did not set window.scrapedData');
          // Try to run extraction manually
          if (typeof extractScheduleData === 'function') {
            window.scrapedData = extractScheduleData();
          } else {
            console.error('extractScheduleData function not found');
          }
        }
        return {
          data: window.scrapedData || null,
          hasFunction: typeof extractScheduleData !== 'undefined',
          hasData: typeof window.scrapedData !== 'undefined'
        };
      }
    });
    
    const result = dataResults[0].result;
    console.log('Content script execution check:', result);
    
    if (!result.data && result.hasFunction) {
      // Try to execute extraction directly
      const directResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Re-run extraction
          if (typeof extractScheduleData === 'function') {
            return extractScheduleData();
          }
          return null;
        }
      });
      return directResult[0].result || [];
    }
    
    return result.data || [];
  } catch (error) {
    console.error('Error extracting week data:', error);
    return [];
  }
}

// Select week in dropdown and wait for update
async function selectWeek(tabId, weekValue, waitTime) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (weekValue) => {
        const weekSelect = document.querySelector('#ctl00_mainContent_drpSelectWeek');
        if (weekSelect) {
          weekSelect.value = weekValue;
          // Trigger ASP.NET postback
          if (typeof __doPostBack === 'function') {
            __doPostBack('ctl00$mainContent$drpSelectWeek', '');
          } else {
            // Fallback: dispatch change event
            const event = new Event('change', { bubbles: true });
            weekSelect.dispatchEvent(event);
          }
        }
      },
      args: [weekValue]
    });
    
    // Wait for DOM update
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    // Wait for table to be ready (with timeout)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (timeout) => {
          return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const checkTable = () => {
              const table = document.querySelector('table thead th[rowspan="2"]');
              const tbody = document.querySelector('table tbody');
              if (table && tbody && tbody.querySelectorAll('tr').length > 0) {
                resolve();
              } else if (Date.now() - startTime > timeout) {
                reject(new Error('Table not ready within timeout'));
              } else {
                setTimeout(checkTable, 100);
              }
            };
            checkTable();
          });
        },
        args: [waitTime * 2] // Give it double the wait time
      });
    } catch (error) {
      console.warn('Table readiness check failed, proceeding anyway:', error);
    }
    
    return true;
  } catch (error) {
    console.error('Error selecting week:', error);
    return false;
  }
}

// Helper function to send message to content script
async function sendMessageToContentScript(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // Ignore errors if content script isn't ready or tab is closed
    console.log('Could not send message to content script:', error.message);
  }
}

// Inject minimal overlay script immediately (runs before full content script)
// This ensures overlay appears instantly on page load
async function injectMinimalOverlay(tabId, title, message, dismissText, progressText, extensionName) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (title, message, dismissText, progressText, extensionName) => {
        // Function to create overlay
        const createOverlayNow = () => {
          // Check if overlay already exists
          if (document.getElementById('fptu-calendar-overlay')) {
            return;
          }
          
          // Check sessionStorage
          const isScraping = sessionStorage.getItem('fptu_scraping_active') === 'true';
          if (!isScraping && !title) {
            return; // Don't show if not scraping
          }
          
          // Use provided values or fallback to sessionStorage
          // Note: sessionStorage is accessed here (in page context), not in background script
          const overlayTitle = title || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_overlay_title') : null) || 'Đang trích xuất lịch học';
          const overlayMessage = message || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_overlay_message') : null) || 'Đang trích xuất lịch học cho bạn...';
          const overlayDismiss = dismissText || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_overlay_dismiss') : null) || 'Đóng';
          const overlayProgress = progressText || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_scraping_progress') : null) || '';
          const extName = extensionName || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_extension_name') : null) || 'FPTU Study Calendar';
          
          // Create style element if it doesn't exist
          let styleEl = document.getElementById('fptu-calendar-overlay-style');
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'fptu-calendar-overlay-style';
            styleEl.textContent = `
              #fptu-calendar-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.75);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              }
              #fptu-calendar-overlay .overlay-content {
                background: #ffffff;
                border-radius: 12px;
                padding: 32px;
                max-width: 400px;
                width: 90%;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                text-align: center;
              }
              #fptu-calendar-overlay .overlay-extension-name {
                font-size: 12px;
                font-weight: 500;
                color: #10b981;
                margin-bottom: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
              }
              #fptu-calendar-overlay .overlay-title {
                font-size: 20px;
                font-weight: 600;
                color: #171717;
                margin-bottom: 8px;
                line-height: 1.2;
              }
              #fptu-calendar-overlay .overlay-message {
                font-size: 14px;
                color: #525252;
                margin-bottom: 24px;
                line-height: 1.5;
              }
              #fptu-calendar-overlay .overlay-progress {
                font-size: 16px;
                font-weight: 500;
                color: #10b981;
                margin-bottom: 24px;
                min-height: 24px;
              }
              #fptu-calendar-overlay .spinner {
                width: 40px;
                height: 40px;
                margin: 0 auto 24px;
                border: 4px solid #e5e5e5;
                border-top-color: #10b981;
                border-radius: 50%;
                animation: spin 1s linear infinite;
              }
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
              #fptu-calendar-overlay .overlay-button {
                background: #10b981;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 12px 24px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.2s;
                font-family: inherit;
                display: block;
                margin: 0 auto;
              }
              #fptu-calendar-overlay .overlay-button:hover {
                background: #059669;
              }
              #fptu-calendar-overlay .overlay-button:active {
                transform: scale(0.98);
              }
              #fptu-calendar-overlay.complete .spinner {
                display: none;
              }
              #fptu-calendar-overlay.complete .overlay-progress {
                color: #10b981;
                font-weight: 600;
              }
            `;
            (document.head || document.documentElement).appendChild(styleEl);
          }
          
          // Create overlay element
          const overlay = document.createElement('div');
          overlay.id = 'fptu-calendar-overlay';
          overlay.innerHTML = `
            <div class="overlay-content">
              <div class="overlay-extension-name">${extName}</div>
              <div class="overlay-title">${overlayTitle}</div>
              <div class="overlay-message">${overlayMessage}</div>
              <div class="spinner"></div>
              <div class="overlay-progress">${overlayProgress}</div>
              <button class="overlay-button" id="overlay-dismiss" style="display: none;">${overlayDismiss}</button>
            </div>
          `;
          
          // Add dismiss handler
          overlay.querySelector('#overlay-dismiss').addEventListener('click', () => {
            overlay.remove();
          });
          
          // Append to body (or documentElement if body doesn't exist yet)
          const target = document.body || document.documentElement;
          target.appendChild(overlay);
        };
        
        // Try to create immediately
        if (document.readyState === 'loading') {
          // If still loading, wait for DOMContentLoaded
          if (document.addEventListener) {
            document.addEventListener('DOMContentLoaded', createOverlayNow, { once: true });
          } else {
            // Fallback for older browsers
            const checkReady = setInterval(() => {
              if (document.readyState !== 'loading') {
                clearInterval(checkReady);
                createOverlayNow();
              }
            }, 10);
          }
        } else {
          // DOM is ready, create immediately
          createOverlayNow();
        }
      },
      args: [title, message, dismissText, progressText, extensionName],
      world: 'MAIN' // Run in main world for immediate execution
    });
  } catch (error) {
    console.log('Could not inject minimal overlay:', error.message);
  }
}

// Track active scraping sessions for overlay injection
const activeScrapingTabs = new Map(); // tabId -> { title, message, dismissText }

// Listen for tab updates to inject overlay immediately when page starts loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only handle timetable page
  if (!tab.url || !tab.url.includes('ScheduleOfWeek.aspx')) {
    return;
  }
  
  // If page is starting to load and we have active scraping for this tab
  if (changeInfo.status === 'loading' && activeScrapingTabs.has(tabId)) {
    const overlayData = activeScrapingTabs.get(tabId);
    
    // Inject overlay immediately (don't wait)
    // Progress text will be read from sessionStorage inside the injected script
    injectMinimalOverlay(tabId, overlayData.title, overlayData.message, overlayData.dismissText, null, overlayData.extensionName).catch(() => {
      // Ignore errors - will retry when page loads
    });
  }
});

// Main scraping function
async function startScraping(startDate, endDate, waitTime) {
  const errors = [];
  const allWeeksData = [];
  let timetableTab = null;
  let shouldCloseTab = false; // Track if we created a new tab that should be closed on error
  let tabToClose = null; // Track the tab ID that should be closed on error
  let scrapingSuccessful = false; // Track if scraping completed successfully
  
  try {
    // Step 1: Check if this is the first run (after install/reload)
    const isFirstRunFlag = await isFirstRun();
    
    // Step 2: Check cache to determine if we need login check
    const cachedLoginState = await getCachedLoginState();
    // If first run, always force login check regardless of cache
    const needsLoginCheck = isFirstRunFlag || cachedLoginState === null;
    const isLoggedInFromCache = cachedLoginState === true;
    
    if (isFirstRunFlag) {
      console.log('First run detected, will force login check');
    }
    
    // Step 3: Find existing FAP tab or create new one based on login state
    let fapTab = await findExistingFAPTab();
    
    if (!fapTab) {
      // No existing tab found
      // On first run, always go to homepage to ensure proper login check
      if (isFirstRunFlag) {
        console.log('First run: creating tab to homepage for login check');
        fapTab = await chrome.tabs.create({ url: FAP_BASE_URL, active: false });
        shouldCloseTab = true;
        tabToClose = fapTab.id;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (isLoggedInFromCache) {
        // Cache says logged in, create tab directly to timetable page (skip homepage)
        console.log('Cache indicates logged in, creating tab directly to timetable page');
        fapTab = await chrome.tabs.create({ url: TIMETABLE_URL, active: false });
        shouldCloseTab = true;
        tabToClose = fapTab.id;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        timetableTab = fapTab;
      } else {
        // Need to check login, create tab to homepage
        console.log('Cache invalid/missing, creating tab to homepage for login check');
        fapTab = await chrome.tabs.create({ url: FAP_BASE_URL, active: false });
        shouldCloseTab = true;
        tabToClose = fapTab.id;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    } else {
      console.log('Reusing existing FAP tab:', fapTab.id);
      // If we found an existing tab, make sure it's loaded
      const tabInfo = await chrome.tabs.get(fapTab.id);
      if (tabInfo.status !== 'complete') {
        await new Promise(resolve => {
          const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === fapTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(resolve, waitTime);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    }
    
    // Step 4: Perform login check only if needed
    if (needsLoginCheck) {
      if (isFirstRunFlag) {
        console.log('First run: performing login check');
      } else {
        console.log('Cache invalid/missing, performing login check');
      }
      const isLoggedIn = await checkLogin(fapTab.id, false);
      if (!isLoggedIn) {
        // Show alert to user
        await chrome.scripting.executeScript({
          target: { tabId: fapTab.id },
          func: () => {
            alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
          }
        });
        throw new Error('NOT_LOGGED_IN');
      }
      console.log('Login check passed, user is logged in');
      // Mark first run as completed after successful login check
      if (isFirstRunFlag) {
        await markFirstRunCompleted();
      }
    } else if (!isLoggedInFromCache) {
      // Cache says not logged in, but check anyway (user might have logged in since then)
      console.log('Cached state indicates not logged in, performing login check');
      const isLoggedIn = await checkLogin(fapTab.id, true); // Force check to update cache
      if (!isLoggedIn) {
        await chrome.scripting.executeScript({
          target: { tabId: fapTab.id },
          func: () => {
            alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
          }
        });
        throw new Error('NOT_LOGGED_IN');
      }
    } else {
      // Cache says logged in, but we should still verify before scraping
      // This catches cases where user logged out but cache is stale
      console.log('Cache indicates logged in, will verify login state before scraping');
    }
    
    // Step 5: Navigate to timetable page if not already there
    // (Only if we haven't already created a tab directly to timetable page)
    if (!timetableTab) {
      const isAlreadyOnTimetable = await isOnTimetablePage(fapTab.id);
      if (!isAlreadyOnTimetable) {
        console.log('Not on timetable page, navigating...');
        timetableTab = fapTab;
        if (shouldCloseTab) {
          tabToClose = timetableTab.id;
        }
        await navigateToUrl(timetableTab.id, TIMETABLE_URL, waitTime);
      } else {
        console.log('Already on timetable page, reusing it');
        timetableTab = fapTab;
        if (shouldCloseTab) {
          tabToClose = timetableTab.id;
        }
      }
    } else if (shouldCloseTab) {
      // timetableTab was already set, update tabToClose
      tabToClose = timetableTab.id;
    }
    
    // Step 5.5: Always verify login state before starting to scrape
    // This is critical to catch stale cache cases where user logged out
    // We verify by checking if we can access the timetable page properly
    console.log('Verifying login state before scraping...');
    const isActuallyLoggedIn = await isOnTimetablePage(timetableTab.id);
    
    if (!isActuallyLoggedIn) {
      // User is not actually logged in, invalidate cache and show error
      console.log('Login verification failed - user is not logged in');
      await invalidateLoginCache();
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: () => {
          alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
        }
      });
      throw new Error('NOT_LOGGED_IN');
    }
    
    // If we got here, user is logged in - update cache to ensure it's fresh
    if (isLoggedInFromCache) {
      console.log('Login verification passed, cache was correct');
    } else {
      // Cache was wrong, update it
      console.log('Login verification passed, updating cache');
      await saveLoginStateToCache(true);
    }
    
    // Get localized messages for overlay
    const overlayTitle = chrome.i18n.getMessage('overlayTitle');
    const overlayMessage = chrome.i18n.getMessage('overlayMessage');
    const overlayDismiss = chrome.i18n.getMessage('overlayDismiss');
    const extensionName = chrome.i18n.getMessage('extensionName');
    
    // Register this tab for overlay injection on page loads
    activeScrapingTabs.set(timetableTab.id, {
      title: overlayTitle,
      message: overlayMessage,
      dismissText: overlayDismiss,
      extensionName: extensionName
    });
    
    // Set sessionStorage flag to indicate scraping is starting
    // This ensures overlay persists across page reloads
    await chrome.scripting.executeScript({
      target: { tabId: timetableTab.id },
      func: (title, message, dismissText, extName) => {
        sessionStorage.setItem('fptu_scraping_active', 'true');
        sessionStorage.setItem('fptu_overlay_title', title);
        sessionStorage.setItem('fptu_overlay_message', message);
        sessionStorage.setItem('fptu_overlay_dismiss', dismissText);
        sessionStorage.setItem('fptu_extension_name', extName);
      },
      args: [overlayTitle, overlayMessage, overlayDismiss, extensionName]
    });
    
    // Immediately inject minimal overlay (appears instantly)
    await injectMinimalOverlay(timetableTab.id, overlayTitle, overlayMessage, overlayDismiss, '', extensionName);
    
    // Step 3: Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: timetableTab.id },
      files: ['content.js']
    });
    
    // Wait briefly for content script to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send message to show overlay with localized strings
    // Content script will check sessionStorage first, but this ensures it shows if sessionStorage wasn't set
    await sendMessageToContentScript(timetableTab.id, {
      action: 'showOverlay',
      title: overlayTitle,
      message: overlayMessage,
      dismissText: overlayDismiss
    });
    
    // Step 4: Determine year from start date
    const year = new Date(startDate).getFullYear();
    
    // Step 5: Check current year dropdown value and update if necessary
    const currentYearResult = await chrome.scripting.executeScript({
      target: { tabId: timetableTab.id },
      func: () => {
        const yearSelect = document.querySelector('#ctl00_mainContent_drpYear');
        if (yearSelect) {
          return parseInt(yearSelect.value, 10);
        }
        return null;
      }
    });
    
    const currentYear = currentYearResult[0].result;
    const needsYearUpdate = currentYear === null || currentYear !== year;
    
    if (needsYearUpdate) {
      console.log(`Current year dropdown: ${currentYear}, updating to: ${year}`);
      // Select year
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: (year) => {
          const yearSelect = document.querySelector('#ctl00_mainContent_drpYear');
          if (yearSelect) {
            yearSelect.value = year.toString();
            if (typeof __doPostBack === 'function') {
              __doPostBack('ctl00$mainContent$drpYear', '');
            }
          }
        },
        args: [year]
      });
      
      // Wait for DOM to load after year change
      await new Promise(resolve => setTimeout(resolve, waitTime));
    } else {
      console.log(`Year dropdown already set to ${year}, skipping update`);
    }
    
    // Step 6: Get week options (always fetch fresh after potential year change)
    // If we updated the year, the week dropdown should already be updated
    // If we didn't update, we still need to read the current week options
    const weekOptions = await getWeekOptions(timetableTab.id);
    
    // Step 7: Filter weeks by date range
    const weeksToScrape = filterWeeksByRange(weekOptions, startDate, endDate, year);
    
    console.log(`Found ${weeksToScrape.length} weeks to scrape`);
    
    // Step 8: Iterate through weeks
    for (let i = 0; i < weeksToScrape.length; i++) {
      const week = weeksToScrape[i];
      
      // Send progress update to popup
      try {
        chrome.runtime.sendMessage({
          action: 'progressUpdate',
          currentWeek: i + 1,
          totalWeeks: weeksToScrape.length
        }).catch(() => {}); // Ignore errors if popup is closed
      } catch (e) {
        // Ignore errors
      }
      
          // Get localized progress message
          const progressText = chrome.i18n.getMessage('overlayProgress', [
            (i + 1).toString(),
            weeksToScrape.length.toString()
          ]);
          
          // IMPORTANT: Set sessionStorage BEFORE selecting week (which causes page reload)
          // This ensures overlay persists across page reloads
          await chrome.scripting.executeScript({
            target: { tabId: timetableTab.id },
            func: (weekNum, totalWeeks, progressText) => {
              sessionStorage.setItem('fptu_scraping_active', 'true');
              sessionStorage.setItem('fptu_scraping_week', weekNum.toString());
              sessionStorage.setItem('fptu_scraping_total', totalWeeks.toString());
              sessionStorage.setItem('fptu_scraping_progress', progressText);
            },
            args: [i + 1, weeksToScrape.length, progressText]
          });
          
          // Send progress update to content script for overlay (if page hasn't reloaded yet)
          await sendMessageToContentScript(timetableTab.id, {
            action: 'updateOverlayProgress',
            currentWeek: i + 1,
            totalWeeks: weeksToScrape.length,
            progressText: progressText
          });
          
          // The tabs.onUpdated listener will inject overlay immediately when page starts loading
      
      // IMPORTANT: We should NOT switch years based on week.startYear
      // The week appears in the current year's dropdown, so we should stay on that year
      // The week.startYear is only used for date parsing, not for which dropdown to use
      // For example, week "29/12 To 04/01" appears in 2026 dropdown, so we stay on 2026
      // even though the week starts in 2025
      
      // Pass the correct year for date parsing to content script
      // For weeks that span year boundaries, we need to tell content script which year to use
      // for parsing dates. For "29/12 To 04/01" in 2026 dropdown:
      // - December dates (29/12) should use 2025
      // - January dates (04/01) should use 2026
      // The content script will handle this based on weekSpansBoundary flag
      
      // Set the expected year for date parsing
      // For boundary weeks, we need to pass both the selected year (for the dropdown)
      // and the base year (for parsing December dates)
      const baseYearForParsing = week.startYear || year;
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: (selectedYear, baseYear) => {
          // Store both the selected year (dropdown year) and base year (for parsing)
          window.__selectedYear = selectedYear;
          window.__baseYear = baseYear;
        },
        args: [year, baseYearForParsing]
      });
      
      let success = false;
      let retries = 0;
      
      while (!success && retries < MAX_RETRIES) {
        try {
          // Select week (this will cause page reload via postback)
          // The tabs.onUpdated listener will inject overlay immediately when page starts loading
          const selectSuccess = await selectWeek(timetableTab.id, week.value, waitTime);
          if (!selectSuccess) {
            throw new Error('Failed to select week');
          }
          
          // After page reload, re-inject content script
          // Content script will check sessionStorage and show overlay immediately
          await chrome.scripting.executeScript({
            target: { tabId: timetableTab.id },
            files: ['content.js']
          });
          
          // Wait briefly for content script to initialize
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Send progress update to content script (overlay should already be showing)
          await sendMessageToContentScript(timetableTab.id, {
            action: 'updateOverlayProgress',
            currentWeek: i + 1,
            totalWeeks: weeksToScrape.length,
            progressText: progressText
          });
          
                // Extract data
          const weekData = await extractWeekData(timetableTab.id);
          // weekData is now always an array (empty if no classes)
          if (Array.isArray(weekData)) {
            allWeeksData.push({
              weekNumber: parseInt(week.value),
              weekRange: week.text,
              startDate: week.startDate,
              endDate: week.endDate,
              classes: weekData
            });
            success = true;
            console.log(`Successfully scraped week ${week.text}: ${weekData.length} classes`);
          } else {
            throw new Error('Failed to extract data - invalid format');
          }
        } catch (error) {
          // Check if error might be due to login expiration
          if (error.message.includes('login') || error.message.includes('Login') || 
              error.message.includes('NOT_LOGGED_IN') || error.message.includes('unauthorized')) {
            console.log('Possible login expiration detected, invalidating cache');
            await invalidateLoginCache();
            throw new Error('NOT_LOGGED_IN');
          }
          
          retries++;
          if (retries >= MAX_RETRIES) {
            errors.push({
              week: week.text,
              error: error.message
            });
            console.error(`Failed to scrape week ${week.text} after ${MAX_RETRIES} retries:`, error);
          } else {
            console.log(`Retrying week ${week.text} (attempt ${retries + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
    }
    
    // Send completion message to popup
    try {
      chrome.runtime.sendMessage({
        action: 'scrapingComplete',
        totalWeeks: weeksToScrape.length,
        successCount: allWeeksData.length,
        errorCount: errors.length
      }).catch(() => {});
    } catch (e) {
      // Ignore errors
    }
    
    // Send completion message to content script to update overlay
    if (timetableTab) {
      const completeText = chrome.i18n.getMessage('overlayComplete');
      
      // Remove from active scraping tabs
      activeScrapingTabs.delete(timetableTab.id);
      
      // Clear sessionStorage flags
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: () => {
          sessionStorage.removeItem('fptu_scraping_active');
          sessionStorage.removeItem('fptu_scraping_week');
          sessionStorage.removeItem('fptu_scraping_total');
          sessionStorage.removeItem('fptu_scraping_progress');
        }
      });
      
      await sendMessageToContentScript(timetableTab.id, {
        action: 'scrapingComplete',
        totalWeeks: weeksToScrape.length,
        successCount: allWeeksData.length,
        errorCount: errors.length,
        completeText: completeText
      });
    }
    
    // Mark scraping as successful before returning
    scrapingSuccessful = true;
    
    // Return results
    return {
      success: true,
      data: {
        year,
        weeks: allWeeksData
      },
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error('Scraping error:', error);
    
    // Clear sessionStorage and hide overlay on error
    if (timetableTab) {
      // Remove from active scraping tabs
      activeScrapingTabs.delete(timetableTab.id);
      
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: () => {
          sessionStorage.removeItem('fptu_scraping_active');
          sessionStorage.removeItem('fptu_scraping_week');
          sessionStorage.removeItem('fptu_scraping_total');
          sessionStorage.removeItem('fptu_scraping_progress');
        }
      });
      
      await sendMessageToContentScript(timetableTab.id, {
        action: 'hideOverlay'
      });
    }
    
    return {
      success: false,
      error: error.message
    };
  } finally {
    // Always cleanup: close tab if we created it and scraping failed
    if (shouldCloseTab && tabToClose && !scrapingSuccessful) {
      try {
        console.log('Cleaning up: closing tab', tabToClose, 'due to error');
        await chrome.tabs.remove(tabToClose);
      } catch (e) {
        // Tab may already be closed by user or browser
        console.log('Tab already closed or could not be removed:', e.message);
      }
    }
  }
}

// Flatten weeks data to classes array
function flattenWeeksToClasses(weeksData) {
  const classes = [];
  if (weeksData && weeksData.weeks) {
    weeksData.weeks.forEach(week => {
      if (week.classes && Array.isArray(week.classes)) {
        week.classes.forEach(cls => {
          classes.push(cls);
        });
      }
    });
  }
  return classes;
}

// Merge classes arrays (update existing, add new)
function mergeClasses(existingClasses, newClasses) {
  const merged = [...existingClasses];
  
  newClasses.forEach(newClass => {
    const index = merged.findIndex(c => c.activityId === newClass.activityId);
    if (index !== -1) {
      // Update existing
      merged[index] = newClass;
    } else {
      // Add new
      merged.push(newClass);
    }
  });
  
  return merged;
}

// Save scraped classes to storage
async function saveScrapedClasses(weeksData, mergeMode = 'replace') {
  try {
    const newClasses = flattenWeeksToClasses(weeksData);
    
    // Check if there's existing data
    const existing = await chrome.storage.local.get(['scrapedClasses']);
    const existingClasses = existing.scrapedClasses || [];
    
    let finalClasses;
    if (existingClasses.length > 0 && mergeMode === 'merge') {
      finalClasses = mergeClasses(existingClasses, newClasses);
    } else {
      finalClasses = newClasses;
    }
    
    await chrome.storage.local.set({ scrapedClasses: finalClasses });
    console.log(`Saved ${finalClasses.length} classes to storage (mode: ${mergeMode})`);
  } catch (error) {
    console.error('Error saving scraped classes:', error);
  }
}

// Clear scraped data and date inputs on browser startup
chrome.runtime.onStartup.addListener(async () => {
  chrome.storage.local.remove(['scrapedClasses', 'startDate', 'endDate']);
  // Reset first run flag on browser startup (service worker may have been terminated)
  await resetFirstRunFlag();
  console.log('Cleared scraped classes and date inputs on browser startup, reset first run flag');
});

chrome.runtime.onInstalled.addListener(async (details) => {
  // Reset first run flag on install or update
  await resetFirstRunFlag();
  console.log('Reset first run flag on install/update');
  
  // Only clear on first install, not on updates
  if (details.reason === 'install') {
    chrome.storage.local.get(['scrapedClasses'], (result) => {
      if (!result.scrapedClasses) {
        chrome.storage.local.remove(['scrapedClasses']);
        console.log('Cleared scraped classes on first install');
      }
    });
  }
});

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action);
  
  // Handle ping for testing
  if (message.action === 'ping') {
    sendResponse({ pong: true });
    return false;
  }
  
  if (message.action === 'startScraping') {
    console.log('Starting scraping process...');
    
    // Track if response has been sent to avoid calling sendResponse multiple times
    let responseSent = false;
    
    // Helper function to safely send response
    // Prevents calling sendResponse multiple times and handles closed channels gracefully
    const safeSendResponse = (response) => {
      if (responseSent) {
        console.log('Response already sent, skipping duplicate response');
        return;
      }
      
      try {
        sendResponse(response);
        responseSent = true;
      } catch (e) {
        // Channel already closed (e.g., popup was closed) or other error
        // This is expected behavior when user closes popup during scraping
        console.log('Cannot send response (channel may be closed):', e.message);
        responseSent = true; // Mark as sent to prevent retries
      }
    };
    
    // Handle async response - must return true to keep channel open
    startScraping(message.startDate, message.endDate, message.waitTime, message.mergeMode)
      .then(async (result) => {
        // Log to console
        console.log('Scraping completed:', result);
        if (result.success && result.data) {
          console.log('Scraped data (JSON):', JSON.stringify(result.data, null, 2));
          
          // Save scraped classes to storage
          await saveScrapedClasses(result.data, message.mergeMode || 'replace');
        }
        if (result.errors && result.errors.length > 0) {
          console.log('Failed weeks:', result.errors);
        }
        safeSendResponse(result);
      })
      .catch((error) => {
        console.error('Scraping error:', error);
        safeSendResponse({
          success: false,
          error: error.message
        });
      });
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'progressUpdate') {
    // Forward progress updates to all popup windows
    chrome.runtime.sendMessage(message).catch(() => {});
    return false; // No response needed
  }
  
  return false;
});

