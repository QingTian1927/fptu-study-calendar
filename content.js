// Content script for extracting schedule data from FPTU timetable page

(function() {
  'use strict';

  // Parse time from string like "(7:30-9:00)" or "(12:50-15:10)"
  function parseTime(timeStr) {
    const match = timeStr.match(/\((\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\)/);
    if (!match) return null;
    
    return {
      start: `${match[1].padStart(2, '0')}:${match[2]}`,
      end: `${match[3].padStart(2, '0')}:${match[4]}`
    };
  }

  // Extract slot number from text like "Slot 1" or "Slot 12"
  function extractSlotNumber(slotText) {
    const match = slotText.match(/Slot\s+(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  // Parse date from DD/MM format
  function parseDate(dateStr, year) {
    const [day, month] = dateStr.split('/').map(Number);
    return new Date(year, month - 1, day);
  }

  // Extract class information from a cell
  function extractClassFromCell(cell, dayIndex, dates, baseYear, slotNumber, weekSpansBoundary, selectedYear) {
    const classes = [];
    
    // Check if cell is empty - but be careful, "-" might be in a text node
    const cellText = cell.textContent.trim();
    if (cellText === '-' || cellText === '' || cellText === 'Slot') {
      return classes;
    }
    
    // Check if cell has any class links - this is the most reliable indicator
    const allLinks = cell.querySelectorAll('a[href*="ActivityDetail"]');
    if (allLinks.length === 0) {
      return classes;
    }
    
    // Get all paragraph elements in cell (each represents a class)
    const paragraphs = cell.querySelectorAll('p');
    
    if (paragraphs.length === 0) {
      // Try to extract from cell directly if no paragraphs
      allLinks.forEach(link => {
        const classData = extractClassData(link, cell, dayIndex, dates, baseYear, slotNumber, weekSpansBoundary, selectedYear);
        if (classData) {
          classes.push(classData);
          console.log(`Extracted class: ${classData.subjectCode} from cell (no paragraphs)`);
        }
      });
    } else {
      // Extract from each paragraph
      paragraphs.forEach((paragraph, pIndex) => {
        const link = paragraph.querySelector('a[href*="ActivityDetail"]');
        if (link) {
          const classData = extractClassData(link, paragraph, dayIndex, dates, baseYear, slotNumber, weekSpansBoundary, selectedYear);
          if (classData) {
            classes.push(classData);
            console.log(`Extracted class: ${classData.subjectCode} from paragraph ${pIndex}`);
          } else {
            console.warn(`Failed to extract class data from paragraph ${pIndex}:`, paragraph.textContent.substring(0, 100));
          }
        }
      });
    }
    
    return classes;
  }

  // Extract class data from link and container
  function extractClassData(link, container, dayIndex, dates, baseYear, slotNumber, weekSpansBoundary, selectedYear) {
    try {
      // Extract subject code (text before "-" in link)
      const subjectCodeMatch = link.textContent.match(/^([A-Z0-9]+)-?/);
      const subjectCode = subjectCodeMatch ? subjectCodeMatch[1] : '';
      
      // Extract activity ID from href
      const activityIdMatch = link.href.match(/id=(\d+)/);
      const activityId = activityIdMatch ? activityIdMatch[1] : '';
      
      // Extract location (text after "at ")
      // Stop before " - " (Meet URL), status patterns like "(Not yet)", or time patterns like "(12:50-15:10)"
      // Also stop at line breaks or HTML tags
      let location = '';
      const containerText = container.textContent;
      const atMatch = containerText.match(/at\s+(.+?)(?:\s*-\s*(?:Meet\s+URL|$)|\(Not\s+yet\)|\(attended\)|\(absent\)|\(\d{1,2}:\d{2}-\d{1,2}:\d{2}\)|\n|\r|<|$)/i);
      if (atMatch) {
        location = atMatch[1].trim();
        // Remove trailing dash if present
        location = location.replace(/\s*-\s*$/, '').trim();
      }
      
      // Extract time from label-success span
      const timeSpan = container.querySelector('span.label.label-success');
      const timeStr = timeSpan ? timeSpan.textContent.trim() : '';
      const time = parseTime(timeStr);
      
      if (!time) {
        console.warn('Could not parse time for class:', subjectCode);
        return null;
      }
      
      // Extract status
      let status = 'Not yet';
      if (container.textContent.includes('attended')) {
        status = 'attended';
      } else if (container.textContent.includes('absent')) {
        status = 'absent';
      } else if (container.textContent.includes('Not yet')) {
        status = 'Not yet';
      }
      
      // Extract Meet URL if present
      let meetUrl = null;
      const meetLink = container.querySelector('a[href*="meet.google.com"]');
      if (meetLink) {
        meetUrl = meetLink.href;
      }
      
      // Check if online - look for online-indicator in the cell (parent of container)
      // or if there's a meet URL, or if location contains "Meet URL"
      const cell = container.closest('td');
      const hasOnlineIndicator = cell ? cell.querySelector('.online-indicator') !== null : false;
      const hasMeetUrl = meetUrl !== null;
      const locationHasMeetUrl = location.toLowerCase().includes('meet url');
      const isOnline = hasOnlineIndicator || hasMeetUrl || locationHasMeetUrl;
      
      // For online classes without a meet URL, explicitly set meetUrl to null
      if (isOnline && !hasMeetUrl) {
        meetUrl = null;
      }
      
      // Get date for this day
      const dateStr = dates[dayIndex];
      if (!dateStr) {
        console.warn(`No date string for day index ${dayIndex}`);
        return null;
      }
      
      // Parse date and determine correct year
      const [day, month] = dateStr.split('/').map(Number);
      let dateYear = baseYear;
      
      // If week spans year boundary (Dec to Jan), adjust year for January dates
      if (weekSpansBoundary && month === 1) {
        // January dates are in the selected year (next year relative to baseYear)
        dateYear = selectedYear;
      } else if (weekSpansBoundary && month === 12) {
        // December dates are in the base year (previous year relative to selectedYear)
        dateYear = baseYear;
      }
      
      const date = parseDate(dateStr, dateYear);
      
      // Get day name
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = dayNames[date.getDay()];
      
      return {
        subjectCode,
        day: dayName,
        date: date.toISOString().split('T')[0],
        slot: slotNumber,
        time: {
          start: time.start,
          end: time.end
        },
        location: location || '',
        isOnline,
        meetUrl: meetUrl,
        status,
        activityId
      };
    } catch (error) {
      console.error('Error extracting class data:', error);
      return null;
    }
  }

  // Main extraction function
  function extractScheduleData() {
    try {
      // Get year from dropdown, but prefer the values set by background script
      const yearSelect = document.querySelector('#ctl00_mainContent_drpYear');
      let selectedYear = yearSelect ? parseInt(yearSelect.value, 10) : new Date().getFullYear();
      let baseYear = selectedYear;
      
      // Check if background script set year values (for handling year boundaries)
      if (typeof window.__selectedYear !== 'undefined') {
        selectedYear = window.__selectedYear;
        console.log('Using selected year from background script:', selectedYear);
      }
      if (typeof window.__baseYear !== 'undefined') {
        baseYear = window.__baseYear;
        console.log('Using base year from background script:', baseYear);
      }
      
      // Get week range from dropdown to determine if week spans year boundary
      const weekSelect = document.querySelector('#ctl00_mainContent_drpSelectWeek');
      const selectedOption = weekSelect ? weekSelect.options[weekSelect.selectedIndex] : null;
      const weekRange = selectedOption ? selectedOption.text.trim() : '';
      
      // Determine if week spans year boundary
      // baseYear is already set from window.__baseYear if provided by background script
      // If not provided, calculate it based on whether week spans boundary
      let weekSpansBoundary = false;
      
      if (weekRange) {
        const weekMatch = weekRange.match(/(\d{2}\/\d{2})\s+To\s+(\d{2}\/\d{2})/);
        if (weekMatch) {
          const [, startStr, endStr] = weekMatch;
          const [startDay, startMonth] = startStr.split('/').map(Number);
          const [endDay, endMonth] = endStr.split('/').map(Number);
          
          // If week spans year boundary (e.g., Dec to Jan)
          if (startMonth === 12 && endMonth === 1) {
            weekSpansBoundary = true;
            // If baseYear wasn't set by background script, calculate it
            if (typeof window.__baseYear === 'undefined') {
              baseYear = selectedYear - 1;
            }
          }
        }
      }
      
      // Find the correct schedule table - it has a thead with th[rowspan="2"] containing year/week dropdowns
      // AND a tbody with rows starting with "Slot" in the first cell
      const allTables = document.querySelectorAll('table');
      let scheduleTable = null;
      let thead = null;
      
      console.log(`Found ${allTables.length} tables on page`);
      
      for (let i = 0; i < allTables.length; i++) {
        const table = allTables[i];
        const testThead = table.querySelector('thead');
        const testTbody = table.querySelector('tbody');
        
        if (testThead && testTbody) {
          // Check if this table has the year/week selector structure
          const yearWeekTh = testThead.querySelector('th[rowspan="2"]');
          const yearSelect = yearWeekTh ? yearWeekTh.querySelector('#ctl00_mainContent_drpYear') : null;
          
          // Also verify it has slot rows (not just the "FAP mobile app" table)
          const firstRow = testTbody.querySelector('tr');
          const firstCell = firstRow ? firstRow.querySelector('td') : null;
          const hasSlotRows = firstCell && firstCell.textContent.trim().toLowerCase().startsWith('slot');
          
          if (yearSelect && hasSlotRows) {
            scheduleTable = table;
            thead = testThead;
            console.log(`Found schedule table at index ${i} with year dropdown and slot rows`);
            break;
          }
        }
      }
      
      if (!scheduleTable || !thead) {
        console.error('Schedule table not found - could not find table with year/week dropdowns and slot rows');
        return []; // Return empty array instead of null
      }
      
      const dateRow = thead.querySelector('tr:nth-child(2)');
      if (!dateRow) {
        console.error('Date row not found');
        return []; // Return empty array instead of null
      }
      
      const dateHeaders = Array.from(dateRow.querySelectorAll('th'));
      // Skip first column (year/week selector)
      const dates = dateHeaders.slice(1).map(th => th.textContent.trim());
      
      if (dates.length !== 7) {
        console.warn('Expected 7 date headers, found:', dates.length, 'Proceeding with available dates');
        // Continue with what we have instead of returning null
      }
      
      console.log('Date headers:', dates);
      
      // Get table body from the correct schedule table
      const tbody = scheduleTable.querySelector('tbody');
      
      if (!tbody) {
        console.error('Table body not found');
        return []; // Return empty array instead of null
      }
      
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const classes = [];
      
      console.log(`Found ${rows.length} rows in table body`);
      
      // Process each row (slot)
      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) {
          console.log(`Row ${rowIndex}: Skipping - only ${cells.length} cells`);
          return; // Need at least slot + one day
        }
        
        // First cell contains slot number
        const slotCell = cells[0];
        const slotText = slotCell ? slotCell.textContent.trim() : '';
        const slotNumber = extractSlotNumber(slotText);
        
        if (slotNumber === null) {
          console.log(`Row ${rowIndex}: Skipping - no slot number found in "${slotText}"`);
          return; // Skip if slot number not found
        }
        
        // Process each day column (skip first column which is slot number)
        // Handle cases where there might be fewer than 7 day columns
        const dayColumns = Math.min(7, cells.length - 1);
        for (let dayIndex = 0; dayIndex < dayColumns; dayIndex++) {
          const cell = cells[dayIndex + 1];
          if (!cell) continue;
          
          // Check if cell has any links before processing
          const links = cell.querySelectorAll('a[href*="ActivityDetail"]');
          if (links.length > 0) {
            console.log(`Row ${rowIndex}, Slot ${slotNumber}, Day ${dayIndex}: Found ${links.length} class link(s)`);
          }
          
          // Pass the year context for proper date parsing
          const cellClasses = extractClassFromCell(cell, dayIndex, dates, baseYear, slotNumber, weekSpansBoundary, selectedYear);
          if (cellClasses && cellClasses.length > 0) {
            classes.push(...cellClasses);
            console.log(`Row ${rowIndex}, Slot ${slotNumber}, Day ${dayIndex}: Successfully extracted ${cellClasses.length} class(es)`);
          }
        }
      });
      
      console.log(`Total extracted: ${classes.length} classes from table`);
      
      // Return empty array if no classes found (not null)
      return classes;
      
    } catch (error) {
      console.error('Error extracting schedule data:', error);
      return []; // Return empty array instead of null
    }
  }

  // Execute extraction immediately
  // The background script will wait for the page to be ready before calling this
  console.log('Content script loaded, starting extraction...');
  const scrapedData = extractScheduleData();
  window.scrapedData = scrapedData;
  console.log('Content script extraction complete. Found', scrapedData ? scrapedData.length : 0, 'classes');
  console.log('Sample data:', scrapedData && scrapedData.length > 0 ? scrapedData[0] : 'No data');
  
  // Also expose the extraction function globally for debugging
  window.extractScheduleData = extractScheduleData;
  
  return scrapedData;
})();

