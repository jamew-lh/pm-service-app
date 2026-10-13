// Settings for the PM Service app.
// Machines are not listed here: the app reads every table in the base that has
// an "EQUIPMENT ID" field, so a new machine table shows up automatically.

export const BASE_ID = 'appkO20s2F5HjRhhv'; // "Equipment PM Services"

// Field names, exactly as they appear in every machine table.
export const F = {
  equipment: 'EQUIPMENT ID',
  serial: 'SERIAL #',
  hours: 'HOURS',
  date: 'DATE',
  employee: 'EMPLOYEE',
  level: 'SERVICE LEVEL',
  types: 'SERVICE TYPE',
  notes: 'SERVICE NOTES',
  filters: 'FILTERS CHANGED',
  parts: 'OTHER FILTERS/PARTS',
  sheet: 'PM SHEET',
};

// Fluid fields, in the order they appear in the tables.
export const FLUIDS = ['5W30', '10W40', '15W40', '10W', '30W', '50W', 'ATF', 'ANTIFREEZE', 'GEAR LUBE', 'GREASE', 'OTHER'];
export const UNITS = ['GAL', 'QT', 'TUBE', 'LB', 'OZ'];

export const MECHANICS = ['DOUG GREIG', 'CHAD SMOKER', 'MARK SMOKER', 'DAKOTA JENKINS', 'RUSHANE DAVIS MORGAN'];
export const LEVELS = ['SERVICE 1', 'SERVICE 2', 'SERVICE 3'];
export const TYPES = ['AIR', 'OIL', 'FUEL', 'HYD'];

export const TIME_ZONE = 'America/New_York';

// Sign-in
export const SESSION_DAYS = { mech: 180, office: 30 };
export const LOCKOUT = { maxFailures: 5, windowMinutes: 15, lockMinutes: 15 };

// Office list: a machine's cached records are re-checked after this long.
export const CACHE_FRESH_MINUTES = 10;
