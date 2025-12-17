// Calendar preview page JavaScript

let allClasses = [];
let currentWeekStart = null;
let currentEditingClass = null;

// Load classes from storage
async function loadClasses() {
  try {
    const result = await chrome.storage.local.get(['scrapedClasses']);
    if (result.scrapedClasses) {
      allClasses = result.scrapedClasses;
      renderCalendar();
    } else {
      showEmptyState();
    }
  } catch (error) {
    console.error('Error loading classes:', error);
    showEmptyState();
  }
}

// Save classes to storage
async function saveClasses() {
  try {
    await chrome.storage.local.set({ scrapedClasses: allClasses });
  } catch (error) {
    console.error('Error saving classes:', error);
  }
}

// Get week start date (Monday)
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

// Format date for display
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Get classes for a specific week
function getClassesForWeek(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  // Normalize dates to start of day for comparison
  const weekStartNormalized = new Date(weekStart);
  weekStartNormalized.setHours(0, 0, 0, 0);
  const weekEndNormalized = new Date(weekEnd);
  weekEndNormalized.setHours(23, 59, 59, 999);
  
  // Build a set of day/month combinations for this week (to handle year mismatches)
  const weekDayMonths = new Set();
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStartNormalized);
    day.setDate(day.getDate() + i);
    const dayMonth = `${day.getMonth()}-${day.getDate()}`;
    weekDayMonths.add(dayMonth);
  }
  
  return allClasses.filter(cls => {
    const classDate = new Date(cls.date + 'T00:00:00');
    
    // First try exact date match
    if (classDate >= weekStartNormalized && classDate <= weekEndNormalized) {
      return true;
    }
    
    // If no match, try matching by day/month (in case of year mismatch)
    const classDayMonth = `${classDate.getMonth()}-${classDate.getDate()}`;
    if (weekDayMonths.has(classDayMonth)) {
      return true;
    }
    
    return false;
  });
}

// Get all weeks that contain classes
function getAllWeeksWithClasses() {
  if (allClasses.length === 0) return [];
  
  const weekStarts = new Set();
  allClasses.forEach(cls => {
    const classDate = new Date(cls.date);
    const weekStart = getWeekStart(classDate);
    weekStarts.add(weekStart.toISOString().split('T')[0]);
  });
  
  return Array.from(weekStarts)
    .map(dateStr => new Date(dateStr))
    .sort((a, b) => a - b);
}

// Format week for selector
function formatWeekForSelector(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
}

// Calculate time position in grid (minutes from 7:00)
function getTimePosition(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const totalMinutes = (hours * 60 + minutes) - (7 * 60); // Offset from 7:00
  return totalMinutes; // Return in minutes
}

// Calculate block height (in minutes)
function getBlockHeight(startTime, endTime) {
  const start = getTimePosition(startTime);
  const end = getTimePosition(endTime);
  return end - start; // Return in minutes
}

// Render week view
function renderWeekView() {
  if (!currentWeekStart) {
    // Set to current week or first week with classes
    if (allClasses.length > 0) {
      const firstClassDate = new Date(allClasses[0].date);
      currentWeekStart = getWeekStart(firstClassDate);
    } else {
      currentWeekStart = getWeekStart(new Date());
    }
  }

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  
  // Update week selector
  const weekSelector = document.getElementById('weekSelector');
  const allWeeks = getAllWeeksWithClasses();
  
  // If no classes, add current week
  if (allWeeks.length === 0) {
    allWeeks.push(currentWeekStart);
  }
  
  weekSelector.innerHTML = '';
  allWeeks.forEach(weekStart => {
    const option = createElement('option', '', formatWeekForSelector(weekStart));
    option.value = weekStart.toISOString().split('T')[0];
    if (weekStart.toISOString().split('T')[0] === currentWeekStart.toISOString().split('T')[0]) {
      option.selected = true;
    }
    weekSelector.appendChild(option);
  });

  const weekClasses = getClassesForWeek(currentWeekStart);
  console.log('Current week start:', currentWeekStart);
  console.log('Week classes found:', weekClasses.length);
  console.log('All classes:', allClasses.length);
  
  const grid = document.getElementById('weekGrid');
  grid.innerHTML = '';

  // Create slot labels (Slot 0 to Slot 12)
  const slots = [];
  for (let slot = 0; slot <= 12; slot++) {
    slots.push(`Slot ${slot}`);
  }

  // Create grid structure
  // Header row
  grid.appendChild(createElement('div', 'time-slot', ''));
  for (let i = 0; i < 7; i++) {
    const day = new Date(currentWeekStart);
    day.setDate(day.getDate() + i);
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const dayName = dayNames[day.getDay()];
    const dayHeader = createElement('div', 'day-header', '');
    dayHeader.innerHTML = `<div>${dayName}</div><div style="font-size: 11px; color: #666;">${formatDate(day)}</div>`;
    grid.appendChild(dayHeader);
  }

  // Create slot rows (Slot 0 to Slot 12 = 13 rows)
  slots.forEach((slotLabel, slotIndex) => {
    // Slot label
    const slotLabelEl = createElement('div', 'time-slot', slotLabel);
    slotLabelEl.style.gridRow = slotIndex + 2;
    slotLabelEl.style.gridColumn = 1;
    grid.appendChild(slotLabelEl);
    
    // Day cells for this slot
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayCell = createElement('div', 'day-cell', '');
      dayCell.dataset.day = dayIndex;
      dayCell.dataset.slot = slotIndex;
      dayCell.id = `day-cell-${dayIndex}-slot-${slotIndex}`;
      dayCell.style.gridRow = slotIndex + 2;
      dayCell.style.gridColumn = dayIndex + 2;
      grid.appendChild(dayCell);
    }
  });

  // Add class blocks - place them in the correct slot cell
  weekClasses.forEach(cls => {
    const classDate = new Date(cls.date + 'T00:00:00');
    const weekStartDate = new Date(currentWeekStart);
    weekStartDate.setHours(0, 0, 0, 0);
    
    // Calculate day index - handle year mismatches by matching day/month
    let dayIndex = -1;
    const classDay = classDate.getDate();
    const classMonth = classDate.getMonth();
    
    // Find which day of the week this class belongs to
    for (let i = 0; i < 7; i++) {
      const weekDay = new Date(weekStartDate);
      weekDay.setDate(weekDay.getDate() + i);
      if (weekDay.getDate() === classDay && weekDay.getMonth() === classMonth) {
        dayIndex = i;
        break;
      }
    }
    
    console.log('Processing class:', cls.subjectCode, 'date:', cls.date, 'dayIndex:', dayIndex, 'slot:', cls.slot);
    
    if (dayIndex >= 0 && dayIndex < 7 && cls.slot !== undefined && cls.slot !== null) {
      const slotIndex = cls.slot;
      if (slotIndex >= 0 && slotIndex <= 12) {
        const dayCell = document.getElementById(`day-cell-${dayIndex}-slot-${slotIndex}`);
        if (dayCell) {
          const block = createClassBlock(cls);
          dayCell.appendChild(block);
          console.log('Added class to cell:', `day-cell-${dayIndex}-slot-${slotIndex}`);
        } else {
          console.warn('Day cell not found:', `day-cell-${dayIndex}-slot-${slotIndex}`);
        }
      } else {
        console.warn('Invalid slot index:', slotIndex);
      }
    } else {
      console.warn('Invalid dayIndex or slot:', dayIndex, cls.slot);
    }
  });
}

// Create class block element
function createClassBlock(cls) {
  const block = createElement('div', `class-block ${cls.isOnline ? 'online' : 'offline'}`, '');
  block.dataset.classId = cls.activityId;
  
  const timeStr = `${cls.time.start} - ${cls.time.end}`;
  const onlineIndicator = cls.isOnline ? '<div class="class-online-indicator">● Online</div>' : '';
  const meetUrlLink = cls.isOnline && cls.meetUrl ? `<a href="${cls.meetUrl}" target="_blank" class="class-meet-link" onclick="event.stopPropagation();">🔗 Meet</a>` : '';
  
  block.innerHTML = `
    <div class="class-name">${cls.subjectCode}</div>
    <div class="class-location">${cls.location || 'N/A'}</div>
    <div class="class-time">${timeStr}</div>
    ${onlineIndicator}
    ${meetUrlLink}
  `;
  block.addEventListener('click', () => openEditModal(cls));
  return block;
}

// Render list view
function renderListView() {
  const listContent = document.getElementById('listContent');
  listContent.innerHTML = '';

  if (allClasses.length === 0) {
    listContent.innerHTML = '<div class="empty-state">Không có lớp học nào</div>';
    return;
  }

  // Sort classes by date and time
  const sortedClasses = [...allClasses].sort((a, b) => {
    const dateA = new Date(a.date + 'T' + a.time.start);
    const dateB = new Date(b.date + 'T' + b.time.start);
    return dateA - dateB;
  });

  sortedClasses.forEach(cls => {
    const item = createElement('div', 'class-item', '');
    item.innerHTML = `
      <div class="class-item-header">
        <div class="class-item-name">${cls.subjectCode}</div>
        <div class="class-item-time">${cls.time.start} - ${cls.time.end}</div>
      </div>
      <div class="class-item-details">
        ${formatDate(cls.date)} • ${cls.location || 'N/A'} ${cls.isOnline ? '• Online' : ''}
      </div>
    `;
    item.addEventListener('click', () => openEditModal(cls));
    listContent.appendChild(item);
  });
}

// Render calendar (switch between views)
function renderCalendar() {
  const isWeekView = document.getElementById('weekViewBtn').classList.contains('active');
  if (isWeekView) {
    renderWeekView();
  } else {
    renderListView();
  }
}

// Show empty state
function showEmptyState() {
  document.getElementById('weekGrid').innerHTML = '<div class="empty-state">Không có lớp học nào</div>';
  document.getElementById('listContent').innerHTML = '<div class="empty-state">Không có lớp học nào</div>';
}

// Open edit modal
function openEditModal(cls) {
  currentEditingClass = cls;
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');

  // Populate form
  document.getElementById('editSubjectCode').value = cls.subjectCode;
  document.getElementById('editDate').value = cls.date;
  document.getElementById('editTimeStart').value = cls.time.start;
  document.getElementById('editTimeEnd').value = cls.time.end;
  document.getElementById('editLocation').value = cls.location || '';
  document.getElementById('editMeetUrl').value = cls.meetUrl || '';
  document.getElementById('editStatus').value = cls.status || 'Not yet';

  modal.classList.add('active');
}

// Close edit modal
function closeEditModal() {
  const modal = document.getElementById('editModal');
  modal.classList.remove('active');
  currentEditingClass = null;
}

// Save edited class
async function saveEditedClass(formData) {
  if (!currentEditingClass) return;

  const index = allClasses.findIndex(c => c.activityId === currentEditingClass.activityId);
  if (index === -1) return;

  // Update class
  allClasses[index] = {
    ...allClasses[index],
    subjectCode: formData.subjectCode,
    date: formData.date,
    time: {
      start: formData.timeStart,
      end: formData.timeEnd
    },
    location: formData.location,
    meetUrl: formData.meetUrl || null,
    status: formData.status,
    isOnline: formData.meetUrl ? true : allClasses[index].isOnline
  };

  await saveClasses();
  renderCalendar();
  closeEditModal();
}

// Delete class
async function deleteClass() {
  if (!currentEditingClass) return;

  if (confirm('Bạn có chắc chắn muốn xóa lớp học này?')) {
    allClasses = allClasses.filter(c => c.activityId !== currentEditingClass.activityId);
    await saveClasses();
    renderCalendar();
    closeEditModal();
  }
}

// Helper function to create element
function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadClasses();

  // View toggle
  document.getElementById('weekViewBtn').addEventListener('click', () => {
    document.getElementById('weekViewBtn').classList.add('active');
    document.getElementById('listViewBtn').classList.remove('active');
    document.getElementById('weekView').classList.remove('hidden');
    document.getElementById('listView').classList.remove('active');
    renderWeekView();
  });

  document.getElementById('listViewBtn').addEventListener('click', () => {
    document.getElementById('listViewBtn').classList.add('active');
    document.getElementById('weekViewBtn').classList.remove('active');
    document.getElementById('weekView').classList.add('hidden');
    document.getElementById('listView').classList.add('active');
    renderListView();
  });

  // Week navigation
  document.getElementById('prevWeekBtn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    renderWeekView();
    updateWeekSelector();
  });

  document.getElementById('nextWeekBtn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    renderWeekView();
    updateWeekSelector();
  });

  // Week selector
  document.getElementById('weekSelector').addEventListener('change', (e) => {
    currentWeekStart = new Date(e.target.value);
    renderWeekView();
  });

  // Update week selector to reflect current week
  function updateWeekSelector() {
    const weekSelector = document.getElementById('weekSelector');
    const currentWeekValue = currentWeekStart.toISOString().split('T')[0];
    const allWeeks = getAllWeeksWithClasses();
    
    // Check if current week is in the list
    const weekExists = allWeeks.some(w => w.toISOString().split('T')[0] === currentWeekValue);
    
    if (!weekExists) {
      // Add current week to selector if not present
      const option = createElement('option', '', formatWeekForSelector(currentWeekStart));
      option.value = currentWeekValue;
      option.selected = true;
      weekSelector.appendChild(option);
      
      // Sort options
      const options = Array.from(weekSelector.options);
      options.sort((a, b) => new Date(a.value) - new Date(b.value));
      weekSelector.innerHTML = '';
      options.forEach(opt => weekSelector.appendChild(opt));
      weekSelector.value = currentWeekValue;
    } else {
      weekSelector.value = currentWeekValue;
    }
  }

  // Edit form
  document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = {
      subjectCode: document.getElementById('editSubjectCode').value,
      date: document.getElementById('editDate').value,
      timeStart: document.getElementById('editTimeStart').value,
      timeEnd: document.getElementById('editTimeEnd').value,
      location: document.getElementById('editLocation').value,
      meetUrl: document.getElementById('editMeetUrl').value,
      status: document.getElementById('editStatus').value
    };
    await saveEditedClass(formData);
  });

  document.getElementById('deleteBtn').addEventListener('click', deleteClass);
  document.getElementById('cancelBtn').addEventListener('click', closeEditModal);

  // Export button (placeholder for now)
  document.getElementById('exportBtn').addEventListener('click', () => {
    alert('Tính năng xuất file sẽ được triển khai sau');
  });

  // Close modal on background click
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') {
      closeEditModal();
    }
  });
});

