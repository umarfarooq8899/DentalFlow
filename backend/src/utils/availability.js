'use strict';

/**
 * Availability helpers for appointment scheduling.
 * All datetime calculations use UTC to avoid ambiguity.
 * Timezone is used only to convert "local working hours" into UTC ranges.
 */

/**
 * Convert "HH:mm" string to minutes-since-midnight.
 * @param {string} hhmm
 * @returns {number}
 */
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Build a UTC Date from a YYYY-MM-DD date string and an HH:mm time string,
 * treating the time as belonging to a named timezone.
 *
 * This implementation uses the Intl API trick: find the UTC offset for the
 * target timezone on the target date, then subtract it.
 *
 * @param {string} dateString – "YYYY-MM-DD"
 * @param {string} timeString – "HH:mm"
 * @param {string} timezone   – IANA timezone (e.g. "America/New_York")
 * @returns {Date}            – UTC Date
 */
function localTimeToUTC(dateString, timeString, timezone) {
  // Parse components
  const [year, month, day] = dateString.split('-').map(Number);
  const [hour, minute] = timeString.split(':').map(Number);

  // Try to determine the UTC offset for this timezone on this date using
  // the Intl.DateTimeFormat trick.
  try {
    // Create a date in the target timezone's "local time"
    // by constructing a fake UTC Date and then reading back what local time
    // that timezone would display for it.
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

    // Get what date/time the target tz would show for our UTC guess
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(utcGuess);
    const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);

    const tzYear = get('year');
    const tzMonth = get('month') - 1;
    const tzDay = get('day');
    const tzHour = get('hour') === 24 ? 0 : get('hour');
    const tzMin = get('minute');
    const tzSec = get('second');

    // Offset = UTC guess - what TZ shows (in ms)
    const tzMs = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMin, tzSec);
    const offsetMs = utcGuess.getTime() - tzMs;

    // Apply offset: local_time_utc = desired_local_in_utc - offset
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) + offsetMs);
  } catch {
    // Fallback: treat as UTC (graceful degradation)
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  }
}

/**
 * Given a dentist's workingHours config and a date string,
 * return the working periods for that day as UTC Date ranges.
 *
 * @param {object} workingHours – DentistProfile.workingHours
 * @param {string} dateString   – "YYYY-MM-DD"
 * @returns {{ isAvailable: boolean, reason?: string, periods: Array<{startUTC: Date, endUTC: Date}> }}
 */
function getDayWorkingPeriodsUTC(workingHours, dateString) {
  const timezone = workingHours?.timezone || 'UTC';
  const daysOff = workingHours?.daysOff || [];
  const weeklySchedule = workingHours?.weeklySchedule || [];

  // Check scheduled days off
  const dayOff = daysOff.find((d) => d.date === dateString);
  if (dayOff) {
    return { isAvailable: false, reason: dayOff.reason || 'Scheduled day off', periods: [] };
  }

  // Determine day of week from the date
  const [year, month, day] = dateString.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = parsedDate.getUTCDay(); // 0=Sun ... 6=Sat

  const schedule = weeklySchedule.find((s) => s.dayOfWeek === dayOfWeek);

  if (!schedule || !schedule.isWorkingDay || !schedule.workingPeriods?.length) {
    return { isAvailable: false, reason: 'Non-working day', periods: [] };
  }

  const periods = schedule.workingPeriods.map((p) => ({
    startUTC: localTimeToUTC(dateString, p.startTime, timezone),
    endUTC: localTimeToUTC(dateString, p.endTime, timezone),
  }));

  return { isAvailable: true, periods };
}

/**
 * Check whether a proposed appointment [proposedStart, proposedEnd)
 * falls within the dentist's working hours on that day.
 *
 * @param {object} workingHours
 * @param {Date} proposedStart – UTC
 * @param {Date} proposedEnd   – UTC
 * @param {string} dateString  – "YYYY-MM-DD" in the dentist's timezone
 * @returns {{ allowed: boolean, reason?: string }}
 */
function isWithinWorkingHours(workingHours, proposedStart, proposedEnd, dateString) {
  const { isAvailable, reason, periods } = getDayWorkingPeriodsUTC(workingHours, dateString);

  if (!isAvailable) return { allowed: false, reason };

  // The appointment must be fully within at least one working period
  const fits = periods.some(
    (p) =>
      proposedStart.getTime() >= p.startUTC.getTime() &&
      proposedEnd.getTime() <= p.endUTC.getTime()
  );

  if (!fits) {
    return { allowed: false, reason: 'Appointment is outside working hours for this day.' };
  }

  return { allowed: true };
}

/**
 * Determine the local date string (YYYY-MM-DD) for a UTC Date in a given timezone.
 * @param {Date} utcDate
 * @param {string} timezone
 * @returns {string}
 */
function utcToLocalDateString(utcDate, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(utcDate); // "YYYY-MM-DD" from en-CA locale
  } catch {
    return utcDate.toISOString().slice(0, 10);
  }
}

module.exports = {
  timeToMinutes,
  localTimeToUTC,
  getDayWorkingPeriodsUTC,
  isWithinWorkingHours,
  utcToLocalDateString,
};
