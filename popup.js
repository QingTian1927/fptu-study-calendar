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

// Calculate end date (5 months after start, but restricted to end of year)
function calculateEndDate(startDate) {
  const start = new Date(startDate);
  const year = start.getFullYear();
  
  // Add 5 months
  const endDate = new Date(start);
  endDate.setMonth(endDate.getMonth() + 5);
  
  // Restrict to end of year
  const yearEnd = getEndOfYear(year);
  return endDate > yearEnd ? yearEnd : endDate;
}

// Initialize popup
async function initPopup() {
  // Set i18n text
  document.getElementById('extensionName').textContent = getMessage('extensionName');
  document.getElementById('startDateLabel').textContent = getMessage('startDateLabel');
  document.getElementById('endDateLabel').textContent = getMessage('endDateLabel');
  document.getElementById('waitTimeLabel').textContent = getMessage('waitTimeLabel');
  document.getElementById('scrapeButton').textContent = getMessage('scrapeButton');
  document.getElementById('exportButton').textContent = getMessage('exportButton');
  document.getElementById('progress').textContent = getMessage('progressDefault');

  // Load saved wait time (default 3000ms)
  const result = await chrome.storage.local.get(['waitTime']);
  const waitTime = result.waitTime || 3000;
  document.getElementById('waitTime').value = waitTime;

  // Set start date to today
  const today = new Date();
  const startDateInput = document.getElementById('startDate');
  startDateInput.value = today.toISOString().split('T')[0];
  
  // Calculate and set end date
  const endDate = calculateEndDate(today);
  const endDateInput = document.getElementById('endDate');
  endDateInput.value = endDate.toISOString().split('T')[0];

  // Update end date when start date changes
  startDateInput.addEventListener('change', () => {
    const newStart = new Date(startDateInput.value);
    const newEnd = calculateEndDate(newStart);
    endDateInput.value = newEnd.toISOString().split('T')[0];
    
    // Update max date to end of year
    const year = newStart.getFullYear();
    endDateInput.max = getEndOfYear(year).toISOString().split('T')[0];
  });

  // Save wait time when changed
  document.getElementById('waitTime').addEventListener('change', (e) => {
    const value = parseInt(e.target.value, 10);
    if (value >= 1000) {
      chrome.storage.local.set({ waitTime: value });
    }
  });

  // Scrape button handler
  document.getElementById('scrapeButton').addEventListener('click', async () => {
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
    const scrapeButton = document.getElementById('scrapeButton');
    const exportButton = document.getElementById('exportButton');
    scrapeButton.disabled = true;
    const progress = document.getElementById('progress');
    progress.className = 'progress';
    progress.textContent = 'Đang khởi tạo...';

    try {
      // Send message to background script
      progress.textContent = 'Đang gửi yêu cầu...';
      
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
        let errorMsg = response.error || 'Lỗi không xác định';
        if (errorMsg === 'NOT_LOGGED_IN') {
          errorMsg = getMessage('errorNotLoggedIn');
        } else if (errorMsg === 'NAVIGATION_FAILED') {
          errorMsg = getMessage('errorNavigation');
        }
        throw new Error(errorMsg);
      }
    } catch (error) {
      progress.className = 'progress error';
      progress.textContent = `Lỗi: ${error.message}`;
      console.error('Scraping error:', error);
    } finally {
      scrapeButton.disabled = false;
    }
  });

  // Preview button handler
  const previewButton = document.getElementById('previewButton');
  previewButton.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('calendar.html') });
  });

  // Export button handler (placeholder for MVP)
  document.getElementById('exportButton').addEventListener('click', () => {
    // This will be implemented later for .ics export
    alert('Tính năng xuất file .ics sẽ được triển khai trong phiên bản tiếp theo');
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
      const progress = document.getElementById('progress');
      progress.className = 'progress';
      progress.textContent = getMessage('progressScraping', [message.currentWeek, message.totalWeeks]);
    } else if (message.action === 'scrapingComplete') {
      // This is handled in the main try/catch, but we can also handle it here if needed
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

