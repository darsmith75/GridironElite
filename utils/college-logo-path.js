function normalizeDivisionTag(division) {
  const value = String(division || '').trim();
  if (!value) return '';

  if (value === 'FBS' || value === 'FCS' || value === 'D2') return value;
  if (value === 'NCAA Division I (FBS)') return 'FBS';
  if (value === 'NCAA Division I (FCS)') return 'FCS';
  if (value === 'NCAA Division II') return 'D2';
  if (value === 'NCAA Division II (D2)') return 'D2';
  return '';
}

function normalizeConferenceTag(conference) {
  const value = String(conference || '').trim();
  return value.replace(/[\\/]+/g, '').trim();
}

function normalizeCollegeLogoPath(logoPath, division, conference) {
  const raw = String(logoPath || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/\\/g, '/');
  if (!normalized.startsWith('images/collegelogos/')) {
    return normalized;
  }

  if (normalized.includes('/FBS/') || normalized.includes('/FCS/') || normalized.includes('/D2/')) {
    return normalized;
  }

  const filename = normalized.split('/').pop();
  if (!filename) return normalized;

  const divisionTag = normalizeDivisionTag(division);
  if (!divisionTag) return normalized;

  const conferenceTag = normalizeConferenceTag(conference);
  if (divisionTag === 'D2' && conferenceTag) {
    const expectedPrefix = `images/collegelogos/${divisionTag}/${conferenceTag}/`;
    if (!normalized.startsWith(expectedPrefix)) {
      return `${expectedPrefix}${filename}`;
    }
  }

  return `images/collegelogos/${divisionTag}/${filename}`;
}

function normalizeCollegeLogoRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    logo: normalizeCollegeLogoPath(row.logo, row.division, row.conference)
  };
}

function normalizeCollegeLogoRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeCollegeLogoRow);
}

module.exports = {
  normalizeDivisionTag,
  normalizeConferenceTag,
  normalizeCollegeLogoPath,
  normalizeCollegeLogoRow,
  normalizeCollegeLogoRows
};
