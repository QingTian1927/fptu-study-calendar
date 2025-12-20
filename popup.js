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
  document.getElementById('aboutGitHub').textContent = getMessage('aboutGitHubValue');
  document.getElementById('themeLabel').textContent = getMessage('themeLabel');
  document.getElementById('themeSystemOption').textContent = getMessage('themeSystem');
  document.getElementById('themeLightOption').textContent = getMessage('themeLight');
  document.getElementById('themeDarkOption').textContent = getMessage('themeDark');
  document.getElementById('scrapeButtonText').textContent = getMessage('scrapeButton');
  document.getElementById('previewButtonText').textContent = getMessage('previewButton');
  document.getElementById('exportButtonText').textContent = getMessage('exportButton');
  document.getElementById('progress').textContent = getMessage('progressDefault');
  
  // Set page title
  document.title = getMessage('popupTitle');
  
  // Initialize settings overlay
  const settingsButton = document.getElementById('settingsButton');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const overlayClose = document.getElementById('overlayClose');
  
  settingsButton.addEventListener('click', () => {
    settingsOverlay.classList.add('active');
  });
  
  overlayClose.addEventListener('click', () => {
    settingsOverlay.classList.remove('active');
  });
  
  // Close overlay when clicking outside
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.classList.remove('active');
    }
  });
  
  // Close overlay with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsOverlay.classList.contains('active')) {
      settingsOverlay.classList.remove('active');
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
  const waitTime = result.waitTime || 3000;
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

  // Save wait time when changed
  document.getElementById('waitTime').addEventListener('change', (e) => {
    const value = parseInt(e.target.value, 10);
    if (value >= 1000) {
      chrome.storage.local.set({ waitTime: value });
    }
  });

  // Get button references early so they're available in all handlers
  const scrapeButton = document.getElementById('scrapeButton');
  const previewButton = document.getElementById('previewButton');
  const exportButton = document.getElementById('exportButton');
  const progress = document.getElementById('progress');

  // Scrape button handler
  scrapeButton.addEventListener('click', async () => {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const waitTime = parseInt(document.getElementById('waitTime').value, 10);

    if (!startDate || !endDate) {
      alert('Vui lòng chọn ngày bắt đầu và ngày kết thúc');
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      alert('Ngày bắt đầu phải trước ngày kết thúc');
      return;
    }

    // Check for existing data and prompt for merge/replace
    const existing = await chrome.storage.local.get(['scrapedClasses']);
    let mergeMode = 'replace';
    if (existing.scrapedClasses && existing.scrapedClasses.length > 0) {
      const userChoice = confirm(
        'Đã có dữ liệu lớp học được lưu trữ.\n\n' +
        'Nhấn OK để thay thế tất cả dữ liệu cũ.\n' +
        'Nhấn Cancel để hợp nhất với dữ liệu hiện có.'
      );
      mergeMode = userChoice ? 'replace' : 'merge';
    }

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
        }, 30000);
        
        chrome.runtime.sendMessage({
          action: 'startScraping',
          startDate,
          endDate,
          waitTime,
          mergeMode
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
        
        // Enable export and preview buttons
        exportButton.disabled = false;
        previewButton.disabled = false;
        
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
      
      // Reset progress after 3 seconds
      setTimeout(() => {
        progress.className = 'progress';
        progress.textContent = getMessage('progressDefault');
      }, 3000);
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

  // Check if there's existing scraped data to enable preview/export buttons
  async function checkExistingData() {
    const result = await chrome.storage.local.get(['scrapedClasses']);
    if (result.scrapedClasses && result.scrapedClasses.length > 0) {
      previewButton.disabled = false;
      document.getElementById('exportButton').disabled = false;
    }
  }
  checkExistingData();

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'progressUpdate') {
      progress.className = 'progress loading';
      progress.textContent = getMessage('progressScraping', [message.currentWeek, message.totalWeeks]);
    } else if (message.action === 'scrapingComplete') {
      // Update progress to show completion
      progress.className = 'progress success';
      progress.textContent = getMessage('progressSuccess');
      
      // Enable preview and export buttons
      previewButton.disabled = false;
      exportButton.disabled = false;
      
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

