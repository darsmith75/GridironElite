function normalizeDivisionTag(division) {
  const value = String(division || '').trim();
  if (!value) return '';

  if (value === 'FBS' || value === 'FCS') return value;
  if (value === 'NCAA Division I (FBS)') return 'FBS';
  if (value === 'NCAA Division I (FCS)') return 'FCS';
  return '';
}

function normalizeCollegeLogoPath(logoPath, division) {
  const raw = String(logoPath || '').trim();
  if (!raw) return null;

  const normalized = raw.replace(/\\/g, '/');
  if (!normalized.startsWith('images/collegelogos/')) {
    return normalized;
  }

  if (normalized.includes('/FBS/') || normalized.includes('/FCS/')) {
    return normalized;
  }

  const filename = normalized.split('/').pop();
  if (!filename) return normalized;

  const divisionTag = normalizeDivisionTag(division);
  if (!divisionTag) return normalized;

  return `images/collegelogos/${divisionTag}/${filename}`;
}

function normalizeCollegeLogoRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    logo: normalizeCollegeLogoPath(row.logo, row.division)
  };
}

function normalizeCollegeLogoRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeCollegeLogoRow);
}

module.exports = {
  normalizeDivisionTag,
  normalizeCollegeLogoPath,
  normalizeCollegeLogoRow,
  normalizeCollegeLogoRows
};
