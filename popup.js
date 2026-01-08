// Timing constants to replace magic numbers
const WAIT_TIMES = {
  DEFAULT_WAIT_TIME: 3000,           // Default wait time for page operations (ms)
  SCRAPING_TIMEOUT: 30000,           // Timeout for scraping operation (ms)
  PROGRESS_RESET_DELAY: 3000         // Delay before resetting progress message (ms)
};

// Internationalization helper
function getMessage(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions);
}

// Format date to DD/MM/YYYY for display
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Get end of year date
function getEndOfYear(year) {
  return new Date(year, 11, 31); // December 31
}

// Comprehensive date range validation
function validateDateRange(startDate, endDate) {
  // Check if dates are empty
  if (!startDate || !endDate) {
    return { valid: false, error: 'Vui lòng chọn ngày bắt đầu và ngày kết thúc' };
  }
  
  // Parse dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Check if dates are valid
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Định dạng ngày không hợp lệ' };
  }
  
  // Check if start date is after end date
  if (start > end) {
    return { valid: false, error: 'Ngày bắt đầu phải trước ngày kết thúc' };
  }
  
  // Check if date range is too large (more than 1 year)
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  if (daysDiff > 365) {
    return { valid: false, error: 'Khoảng thời gian không được vượt quá 1 năm (365 ngày)' };
  }
  
  // Check if date range is too small (less than 1 day)
  if (daysDiff < 1) {
    return { valid: false, error: 'Khoảng thời gian phải ít nhất 1 ngày' };
  }
  
  // All validations passed
  return { valid: true };
}

// Show merge/replace dialog and return user choice
function showMergeReplaceDialog() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('mergeReplaceOverlay');
    const mergeButton = document.getElementById('mergeButton');
    const replaceButton = document.getElementById('replaceButton');
    const cancelButton = document.getElementById('cancelMergeReplaceButton');
    const closeButton = document.getElementById('mergeReplaceOverlayClose');
    
    // Show overlay
    overlay.classList.add('active');
    
    // Handle button clicks
    const handleChoice = (choice) => {
      overlay.classList.remove('active');
      resolve(choice);
    };
    
    mergeButton.addEventListener('click', () => handleChoice('merge'), { once: true });
    replaceButton.addEventListener('click', () => handleChoice('replace'), { once: true });
    cancelButton.addEventListener('click', () => handleChoice(null), { once: true });
    closeButton.addEventListener('click', () => handleChoice(null), { once: true });
    
    // Close on overlay background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        handleChoice(null);
      }
    }, { once: true });
  });
}

// Theme management
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const systemTheme = getSystemTheme();
    root.setAttribute('data-theme', systemTheme);
  } else {
    root.setAttribute('data-theme', theme);
  }
}

async function loadTheme() {
  const result = await chrome.storage.local.get(['theme']);
  const theme = result.theme || 'system';
  applyTheme(theme);
  return theme;
}

async function saveTheme(theme) {
  await chrome.storage.local.set({ theme });
  applyTheme(theme);
  // Notify other extension pages of theme change
  chrome.runtime.sendMessage({ action: 'themeChanged', theme }).catch(() => {
    // Ignore errors if no listeners
  });
}

// Calculate end date (3 months after start, ending at the last day of the month)
function calculateEndDate(startDate) {
  const start = new Date(startDate);
  const year = start.getFullYear();
  
  // Add 3 months
  const endDate = new Date(start);
  endDate.setMonth(endDate.getMonth() + 3);
  
  // Set to the last day of that month
  endDate.setMonth(endDate.getMonth() + 1, 0); // Day 0 = last day of previous month
  
  // Restrict to end of year
  const yearEnd = getEndOfYear(year);
  return endDate > yearEnd ? yearEnd : endDate;
}

// Initialize popup
async function initPopup() {
  // Set i18n text
  document.getElementById('extensionName').textContent = getMessage('extensionName');
  document.getElementById('headerSubtitle').textContent = getMessage('popupSubtitle');
  document.getElementById('sectionDateRange').textContent = getMessage('sectionDateRange');
  document.getElementById('startDateLabel').textContent = getMessage('startDateLabel');
  document.getElementById('endDateLabel').textContent = getMessage('endDateLabel');
  document.getElementById('waitTimeLabel').textContent = getMessage('waitTimeLabel');
  document.getElementById('advancedSettingsText').textContent = getMessage('advancedSettings');
  document.getElementById('aboutTitle').textContent = getMessage('aboutTitle');
  document.getElementById('aboutVersionLabel').textContent = getMessage('aboutVersionLabel');
  document.getElementById('aboutAuthorLabel').textContent = getMessage('aboutAuthorLabel');
  document.getElementById('aboutGitHubLabel').textContent = getMessage('aboutGitHubLabel');
  document.getElementById('aboutHelpLabel').textContent = getMessage('aboutHelpLabel');
  // GitHub link is set in HTML, no need to set textContent
  document.getElementById('themeLabel').textContent = getMessage('themeLabel');
  
  // Initialize donation text if element exists
  const donationText = document.querySelector('.donation-text');
  if (donationText) {
    donationText.textContent = getMessage('donationAppreciated');
  }
  document.getElementById('themeSystemOption').textContent = getMessage('themeSystem');
  document.getElementById('themeLightOption').textContent = getMessage('themeLight');
  document.getElementById('themeDarkOption').textContent = getMessage('themeDark');
  document.getElementById('scrapeButtonText').textContent = getMessage('scrapeButton');
  document.getElementById('previewButtonText').textContent = getMessage('previewButton');
  document.getElementById('exportButtonText').textContent = getMessage('exportButton');
  document.getElementById('progress').textContent = getMessage('progressDefault');
  
  // Set page title
  document.title = getMessage('popupTitle');
  
  // Initialize footer
  document.getElementById('footerMadeBy').textContent = getMessage('footerMadeBy');
  const footerHelpLink = document.getElementById('footerHelpLink');
  footerHelpLink.textContent = getMessage('footerHelpLink');
  
  // Initialize help overlay
  const helpOverlay = document.getElementById('helpOverlay');
  const helpOverlayClose = document.getElementById('helpOverlayClose');
  
  // Set help content localization
  document.getElementById('helpTitle').textContent = getMessage('helpTitle');
  document.getElementById('helpTipsNotice').textContent = getMessage('helpTipsNotice');
  document.getElementById('helpSectionGettingStarted').textContent = getMessage('helpSectionGettingStarted');
  document.getElementById('helpStep1').textContent = getMessage('helpStep1');
  document.getElementById('helpStep2').textContent = getMessage('helpStep2');
  document.getElementById('helpStep3').textContent = getMessage('helpStep3');
  document.getElementById('helpStep4').textContent = getMessage('helpStep4');
  document.getElementById('helpSectionFeatures').textContent = getMessage('helpSectionFeatures');
  // Use innerHTML for items with HTML formatting
  document.getElementById('helpFeature1').innerHTML = getMessage('helpFeature1');
  document.getElementById('helpFeature2').innerHTML = getMessage('helpFeature2');
  document.getElementById('helpFeature3').innerHTML = getMessage('helpFeature3');
  document.getElementById('helpSectionTips').textContent = getMessage('helpSectionTips');
  document.getElementById('helpTip1').textContent = getMessage('helpTip1');
  document.getElementById('helpTip2').textContent = getMessage('helpTip2');
  document.getElementById('helpTip3').textContent = getMessage('helpTip3');
  document.getElementById('helpTip4').textContent = getMessage('helpTip4');
  document.getElementById('helpTip5').innerHTML = getMessage('helpTip5');
  document.getElementById('helpSectionTroubleshooting').textContent = getMessage('helpSectionTroubleshooting');
  // Use innerHTML for items with HTML formatting
  document.getElementById('helpTrouble1').innerHTML = getMessage('helpTrouble1');
  document.getElementById('helpTrouble2').innerHTML = getMessage('helpTrouble2');
  document.getElementById('helpTrouble3').innerHTML = getMessage('helpTrouble3');
  document.getElementById('helpTrouble4').innerHTML = getMessage('helpTrouble4');
  document.getElementById('helpSectionSupport').textContent = getMessage('helpSectionSupport');
  document.getElementById('helpSupportMessage').textContent = getMessage('helpSupportMessage');
  document.getElementById('helpSupportGitHub').textContent = getMessage('helpSupportGitHub');
  document.getElementById('helpSupportEmail').textContent = getMessage('helpSupportEmail');
  
  // Footer help link click handler
  footerHelpLink.addEventListener('click', (e) => {
    e.preventDefault();
    helpOverlay.classList.add('active');
  });
  
  helpOverlayClose.addEventListener('click', () => {
    helpOverlay.classList.remove('active');
  });
  
  // Close help overlay when clicking outside
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) {
      helpOverlay.classList.remove('active');
    }
  });
  
  // Initialize settings overlay
  const settingsButton = document.getElementById('settingsButton');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const overlayClose = document.getElementById('overlayClose');
  
  settingsButton.addEventListener('click', () => {
    settingsOverlay.classList.add('active');
  });
  
  // Function to close settings overlay (with validation)
  function closeSettingsOverlay() {
    // Validate wait time before closing
    if (!isWaitTimeValid()) {
      // Show error and prevent closing
      validateWaitTime(waitTimeInput.value, true);
      alert(getMessage('errorWaitTimeInvalid'));
      return false;
    }
    settingsOverlay.classList.remove('active');
    return true;
  }
  
  overlayClose.addEventListener('click', () => {
    closeSettingsOverlay();
  });
  
  // Close overlay when clicking outside
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      closeSettingsOverlay();
    }
  });
  
  // Close overlay with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (helpOverlay.classList.contains('active')) {
        helpOverlay.classList.remove('active');
      } else if (settingsOverlay.classList.contains('active')) {
        closeSettingsOverlay();
      }
    }
  });

  // Initialize theme
  const savedTheme = await loadTheme();
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.value = savedTheme;
    themeSelect.addEventListener('change', async (e) => {
      await saveTheme(e.target.value);
    });
  }

  // Listen for system theme changes when system theme is selected
  if (savedTheme === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      applyTheme('system');
    });
  }

  // Load saved settings
  const result = await chrome.storage.local.get(['waitTime', 'startDate', 'endDate']);
  let waitTime = result.waitTime || WAIT_TIMES.DEFAULT_WAIT_TIME;
  
  // Validate and clamp saved wait time if invalid
  if (waitTime < 1000) {
    waitTime = 1000;
    chrome.storage.local.set({ waitTime: 1000 });
  } else if (waitTime > 10000) {
    waitTime = 10000;
    chrome.storage.local.set({ waitTime: 10000 });
  }
  
  document.getElementById('waitTime').value = waitTime;

  // Load saved dates or use defaults
  const today = new Date();
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  
  if (result.startDate && result.endDate) {
    // Use saved dates
    startDateInput.value = result.startDate;
    endDateInput.value = result.endDate;
    
    // Set max date for end date based on start date year
    const startYear = new Date(result.startDate).getFullYear();
    endDateInput.max = getEndOfYear(startYear).toISOString().split('T')[0];
  } else {
    // Set start date to today
    startDateInput.value = today.toISOString().split('T')[0];
    
    // Calculate and set end date
    const endDate = calculateEndDate(today);
    endDateInput.value = endDate.toISOString().split('T')[0];
  }

  // Save dates when they change
  startDateInput.addEventListener('change', () => {
    const newStart = new Date(startDateInput.value);
    const newEnd = calculateEndDate(newStart);
    endDateInput.value = newEnd.toISOString().split('T')[0];
    
    // Update max date to end of year
    const year = newStart.getFullYear();
    endDateInput.max = getEndOfYear(year).toISOString().split('T')[0];
    
    // Save to storage
    chrome.storage.local.set({
      startDate: startDateInput.value,
      endDate: endDateInput.value
    });
  });

  endDateInput.addEventListener('change', () => {
    // Save to storage
    chrome.storage.local.set({
      startDate: startDateInput.value,
      endDate: endDateInput.value
    });
  });

  // Wait time validation and save
  const waitTimeInput = document.getElementById('waitTime');
  const waitTimeError = document.getElementById('waitTimeError');
  
  // Validation function - accessible globally for overlay close and scrape checks
  function validateWaitTime(value, showError = true) {
    const numValue = parseInt(value, 10);
    
    // Clear previous error
    if (showError) {
      waitTimeInput.classList.remove('invalid');
      waitTimeError.style.display = 'none';
      waitTimeError.textContent = '';
    }
    
    // Check if empty
    if (value === '' || isNaN(numValue)) {
      if (showError) {
        waitTimeInput.classList.add('invalid');
        waitTimeError.textContent = getMessage('errorWaitTimeRequired');
        waitTimeError.style.display = 'block';
      }
      return false;
    }
    
    // Check if below minimum
    if (numValue < 1000) {
      if (showError) {
        waitTimeInput.classList.add('invalid');
        waitTimeError.textContent = getMessage('errorWaitTimeMin');
        waitTimeError.style.display = 'block';
      }
      return false;
    }
    
    // Check if above maximum
    if (numValue > 10000) {
      if (showError) {
        waitTimeInput.classList.add('invalid');
        waitTimeError.textContent = getMessage('errorWaitTimeMax');
        waitTimeError.style.display = 'block';
      }
      return false;
    }
    
    return true;
  }
  
  // Function to check if wait time is valid (for overlay close and scrape validation)
  function isWaitTimeValid() {
    const value = waitTimeInput.value;
    return validateWaitTime(value, false);
  }
  
  // Validate on input (real-time feedback)
  waitTimeInput.addEventListener('input', (e) => {
    const value = e.target.value;
    if (value !== '') {
      validateWaitTime(value);
    } else {
      // Clear error when field is empty (user is typing)
      waitTimeInput.classList.remove('invalid');
      waitTimeError.style.display = 'none';
    }
  });
  
  // Validate and save on change
  waitTimeInput.addEventListener('change', (e) => {
    const value = e.target.value;
    if (validateWaitTime(value)) {
      const numValue = parseInt(value, 10);
      chrome.storage.local.set({ waitTime: numValue });
    }
  });

  // Get button references early so they're available in all handlers
  const scrapeButton = document.getElementById('scrapeButton');
  const previewButton = document.getElementById('previewButton');
  const exportButton = document.getElementById('exportButton');
  const progress = document.getElementById('progress');

  // Scrape button handler
  scrapeButton.addEventListener('click', async () => {
    // Validate wait time before scraping
    if (!isWaitTimeValid()) {
      // Open settings overlay to show the error
      settingsOverlay.classList.add('active');
      validateWaitTime(waitTimeInput.value, true);
      alert(getMessage('errorWaitTimeInvalid'));
      return;
    }
    
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const waitTime = parseInt(document.getElementById('waitTime').value, 10);

    // Comprehensive date validation
    const validation = validateDateRange(startDate, endDate);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    // Check for existing data and show merge/replace dialog if data exists
    const existing = await chrome.storage.local.get(['scrapedClasses']);
    let mergeMode = false;
    
    if (existing.scrapedClasses && existing.scrapedClasses.length > 0) {
      // Show merge/replace dialog
      const userChoice = await showMergeReplaceDialog();
      if (userChoice === null) {
        return; // User cancelled
      }
      mergeMode = userChoice === 'merge';
    }
    // If no existing data, proceed directly (mergeMode stays false)

    // Disable button and show progress
    scrapeButton.disabled = true;
    progress.className = 'progress loading';
    progress.textContent = getMessage('progressInitializing');

    try {
      // Send message to background script
      progress.textContent = getMessage('progressSending');
      
      const response = await new Promise((resolve, reject) => {
        // Set timeout
        const timeout = setTimeout(() => {
          reject(new Error('Timeout: Không nhận được phản hồi sau 30 giây. Vui lòng kiểm tra console của background script.'));
        }, WAIT_TIMES.SCRAPING_TIMEOUT);
        
        chrome.runtime.sendMessage({
          action: 'startScraping',
          startDate,
          endDate,
          waitTime,
          mergeMode: mergeMode
        }, (response) => {
          clearTimeout(timeout);
          
          if (chrome.runtime.lastError) {
            console.error('Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(`Lỗi: ${chrome.runtime.lastError.message}`));
            return;
          }
          
          if (!response) {
            reject(new Error('Không nhận được phản hồi từ extension. Vui lòng kiểm tra console của background script.'));
            return;
          }
          
          console.log('Received response from background:', response);
          resolve(response);
        });
      });

      if (response.success) {
        // Show success message
        progress.className = 'progress success';
        progress.textContent = getMessage('progressSuccess');
        
        // Log errors if any
        if (response.errors && response.errors.length > 0) {
          console.log('Các tuần không thể trích xuất:', response.errors);
        }
        
        // Enable export button
        exportButton.disabled = false;
        // Preview button is always enabled
        
        // Reset progress after 5 seconds
        setTimeout(() => {
          progress.className = 'progress';
          progress.textContent = getMessage('progressDefault');
        }, 5000);
      } else {
        let errorMsg = response.error || getMessage('errorUnknown');
        if (errorMsg === 'NOT_LOGGED_IN') {
          errorMsg = getMessage('errorNotLoggedIn');
        } else if (errorMsg === 'NAVIGATION_FAILED') {
          errorMsg = getMessage('errorNavigation');
        }
        throw new Error(errorMsg);
      }
    } catch (error) {
      progress.className = 'progress error';
      progress.textContent = `${getMessage('errorPrefix')} ${error.message}`;
      console.error('Scraping error:', error);
    } finally {
      scrapeButton.disabled = false;
    }
  });

  // Preview button handler
  previewButton.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('calendar.html') });
  });

  // Export button handler
  exportButton.addEventListener('click', async () => {
    try {
      // Get classes from storage
      const result = await chrome.storage.local.get(['scrapedClasses']);
      const classes = result.scrapedClasses || [];
      
      if (classes.length === 0) {
        alert('Không có dữ liệu lớp học để xuất. Vui lòng trích xuất lịch học trước.');
        return;
      }
      
      // Export to ICS
      exportToIcs(classes);
      
      // Show success message
      progress.className = 'progress success';
      progress.textContent = `Đã xuất ${classes.length} lớp học thành công!`;
      
      // Reset progress after configured delay
      setTimeout(() => {
        progress.className = 'progress';
        progress.textContent = getMessage('progressDefault');
      }, WAIT_TIMES.PROGRESS_RESET_DELAY);
    } catch (error) {
      console.error('Export error:', error);
      progress.className = 'progress error';
      progress.textContent = `Lỗi xuất file: ${error.message}`;
      
      // Reset progress after 5 seconds
      setTimeout(() => {
        progress.className = 'progress';
        progress.textContent = getMessage('progressDefault');
      }, 5000);
    }
  });

  // Check if there's existing scraped data to enable export button
  async function checkExistingData() {
    const result = await chrome.storage.local.get(['scrapedClasses']);
    if (result.scrapedClasses && result.scrapedClasses.length > 0) {
      document.getElementById('exportButton').disabled = false;
    }
  }
  checkExistingData();
  
  // Preview button is always enabled (no need to check for data)
  previewButton.disabled = false;

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'progressUpdate') {
      progress.className = 'progress loading';
      progress.textContent = getMessage('progressScraping', [message.currentWeek, message.totalWeeks]);
    } else if (message.action === 'scrapingComplete') {
      // Update progress to show completion with week count
      progress.className = 'progress success';
      if (message.totalWeeks !== undefined && message.successCount !== undefined) {
        progress.textContent = getMessage('progressSuccessWithWeeks', [message.successCount.toString(), message.totalWeeks.toString()]);
      } else {
        progress.textContent = getMessage('progressSuccess');
      }
      
      // Enable export button
      exportButton.disabled = false;
      // Preview button is always enabled
      
      // Reset progress after 5 seconds
      setTimeout(() => {
        progress.className = 'progress';
        progress.textContent = getMessage('progressDefault');
      }, 5000);
      
      console.log('Scraping completed:', message);
    }
    return true;
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}

