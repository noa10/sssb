'use strict';

// Match one insertion, deletion, substitution or adjacent transposition.
function isOneTypo(first, second) {
  if (first === second || Math.abs(first.length - second.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edited = false;
  while (i < first.length && j < second.length) {
    if (first[i] === second[j]) { i++; j++; continue; }
    if (edited) return false;
    edited = true;
    if (first.length === second.length) {
      if (first[i] === second[j + 1] && first[i + 1] === second[j]) { i += 2; j += 2; }
      else { i++; j++; }
    } else if (first.length > second.length) i++;
    else j++;
  }
  return !(edited && (i < first.length || j < second.length));
}

module.exports = { isOneTypo };
