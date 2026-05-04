function parseHeightToInches(value) {
  if (value === undefined || value === null) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }

  let match = raw.match(/^(\d+)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (match) {
    const feet = Number(match[1] || '0');
    const inches = Number(match[2] || '0');
    if (Number.isFinite(feet) && Number.isFinite(inches) && feet >= 0 && inches >= 0) {
      return Math.round((feet * 12) + inches);
    }
  }

  match = raw.match(/^(\d+)\s*(?:ft|feet)\s*(\d+(?:\.\d+)?)?\s*(?:in|inches)?$/i);
  if (match) {
    const feet = Number(match[1] || '0');
    const inches = Number(match[2] || '0');
    if (Number.isFinite(feet) && Number.isFinite(inches) && feet >= 0 && inches >= 0) {
      return Math.round((feet * 12) + inches);
    }
  }

  match = raw.match(/^(\d+)\s*[- ]\s*(\d+(?:\.\d+)?)$/);
  if (match) {
    const feet = Number(match[1] || '0');
    const inches = Number(match[2] || '0');
    if (Number.isFinite(feet) && Number.isFinite(inches) && feet >= 0 && inches >= 0) {
      return Math.round((feet * 12) + inches);
    }
  }

  return null;
}

function formatHeightFromInches(value) {
  const inchesTotal = Number(value);
  if (!Number.isFinite(inchesTotal) || inchesTotal <= 0) return null;

  const rounded = Math.round(inchesTotal);
  const feet = Math.floor(rounded / 12);
  const inches = rounded - (feet * 12);
  return `${feet}'${inches}"`;
}

module.exports = {
  parseHeightToInches,
  formatHeightFromInches
};
