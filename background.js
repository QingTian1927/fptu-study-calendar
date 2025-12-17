// Background service worker for FPTU Study Calendar Exporter

const FAP_BASE_URL = 'https://fap.fpt.edu.vn';
const TIMETABLE_URL = 'https://fap.fpt.edu.vn/Report/ScheduleOfWeek.aspx';
const LOGIN_CHECK_SELECTOR = '#ctl00_divUser';
const MAX_RETRIES = 3;

// Log when service worker starts
console.log('FPTU Study Calendar Exporter: Background service worker loaded');

// Wait for DOM to be ready
function waitForDOM(timeout = 30000) {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
      return;
    }
    const checkInterval = setInterval(() => {
      if (document.readyState === 'complete') {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, timeout);
  });
}

// Wait for element to appear
function waitForElement(selector, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) {
      resolve(document.querySelector(selector));
      return;
    }
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

// Check if user is logged in
async function checkLogin(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return document.querySelector('#ctl00_divUser') !== null;
      }
    });
    return results[0].result;
  } catch (error) {
    console.error('Error checking login:', error);
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
async function getWeekOptions(tabId, year, waitTime) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (year) => {
        const yearSelect = document.querySelector('#ctl00_mainContent_drpYear');
        if (yearSelect) {
          yearSelect.value = year.toString();
          // Trigger change event
          const event = new Event('change', { bubbles: true });
          yearSelect.dispatchEvent(event);
        }
      },
      args: [year]
    });

    // Wait for week dropdown to update
    await new Promise(resolve => setTimeout(resolve, waitTime));

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
    // IMPORTANT: When year dropdown shows 2025 and week is "30/12 To 05/01",
    // it means Dec 30, 2024 to Jan 5, 2025 (the LAST week of 2024, shown in 2025's dropdown)
    let weekStartYear = year;
    let weekEndYear = year;
    
    // If week spans year boundary (e.g., 30/12 To 05/01)
    if (startMonth === 12 && endMonth === 1) {
      // Week starts in December of PREVIOUS year, ends in January of CURRENT year
      // This is the last week of the previous year, shown at the start of current year's dropdown
      weekStartYear = year - 1;
      weekEndYear = year;
    } else if (startMonth > endMonth) {
      // Week spans year boundary (e.g., November to January)
      weekStartYear = year - 1;
      weekEndYear = year;
    } else {
      // Week is within the same year
      weekStartYear = year;
      weekEndYear = year;
    }
    
    const weekStartDate = parseDate(weekStartStr, weekStartYear);
    const weekEndDate = parseDate(weekEndStr, weekEndYear);
    
    // Verify the dates make sense
    if (weekEndDate < weekStartDate) {
      // This shouldn't happen, but if it does, adjust
      weekEndYear = weekStartYear + 1;
      const adjustedEndDate = parseDate(weekEndStr, weekEndYear);
      if (adjustedEndDate >= weekStartDate) {
        weekEndDate = adjustedEndDate;
      }
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

// Main scraping function
async function startScraping(startDate, endDate, waitTime) {
  const errors = [];
  const allWeeksData = [];
  
  try {
    // Get or create tab
    let tab = await getCurrentTab();
    
    // Step 1: Navigate to FAP homepage
    if (!tab || !tab.url || !tab.url.startsWith(FAP_BASE_URL)) {
      tab = await chrome.tabs.create({ url: FAP_BASE_URL, active: false });
      await new Promise(resolve => setTimeout(resolve, waitTime));
      // Update tab reference
      const tabs = await chrome.tabs.query({ url: `${FAP_BASE_URL}/*` });
      if (tabs.length > 0) {
        tab = tabs[0];
      }
    } else {
      await navigateToUrl(tab.id, FAP_BASE_URL, waitTime);
    }
    
    // Step 2: Check login
    const isLoggedIn = await checkLogin(tab.id);
    if (!isLoggedIn) {
      // Show alert to user
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
        }
      });
      throw new Error('NOT_LOGGED_IN');
    }
    
    // Step 3: Navigate to timetable page
    const navSuccess = await navigateToUrl(tab.id, TIMETABLE_URL, waitTime);
    if (!navSuccess) {
      // Show alert to user
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          alert('Không thể điều hướng đến trang lịch học. Vui lòng thử lại.');
        }
      });
      console.error('Failed to navigate to timetable page');
      throw new Error('NAVIGATION_FAILED');
    }
    
    // Step 4: Determine year from start date
    const year = new Date(startDate).getFullYear();
    
    // Step 5: Select year
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    // Step 6: Get week options
    const weekOptions = await getWeekOptions(tab.id, year, waitTime);
    
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
      
      // Update year if week spans year boundary
      if (week.startYear && week.startYear !== year) {
        console.log(`Switching to year ${week.startYear} for week ${week.text}`);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (targetYear) => {
            const yearSelect = document.querySelector('#ctl00_mainContent_drpYear');
            if (yearSelect && yearSelect.value !== targetYear.toString()) {
              yearSelect.value = targetYear.toString();
              if (typeof __doPostBack === 'function') {
                __doPostBack('ctl00$mainContent$drpYear', '');
              }
            }
          },
          args: [week.startYear]
        });
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Re-get week options after year change
        const updatedWeekOptions = await getWeekOptions(tab.id, week.startYear, waitTime);
        // Find the matching week in the new year's options
        const matchingWeek = updatedWeekOptions.find(opt => opt.text === week.text);
        if (matchingWeek) {
          week.value = matchingWeek.value;
        }
      }
      
      let success = false;
      let retries = 0;
      
      while (!success && retries < MAX_RETRIES) {
        try {
          // Select week
          const selectSuccess = await selectWeek(tab.id, week.value, waitTime);
          if (!selectSuccess) {
            throw new Error('Failed to select week');
          }
          
                // Extract data
          const weekData = await extractWeekData(tab.id);
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
    
    // Send completion message
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
    return {
      success: false,
      error: error.message
    };
  }
}

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
    
    // Handle async response - must return true to keep channel open
    startScraping(message.startDate, message.endDate, message.waitTime)
      .then((result) => {
        // Log to console
        console.log('Scraping completed:', result);
        if (result.success && result.data) {
          console.log('Scraped data (JSON):', JSON.stringify(result.data, null, 2));
        }
        if (result.errors && result.errors.length > 0) {
          console.log('Failed weeks:', result.errors);
        }
        try {
          sendResponse(result);
        } catch (e) {
          console.error('Error sending response:', e);
        }
      })
      .catch((error) => {
        console.error('Scraping error:', error);
        try {
          sendResponse({
            success: false,
            error: error.message
          });
        } catch (e) {
          console.error('Error sending error response:', e);
        }
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

