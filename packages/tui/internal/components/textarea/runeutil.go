// Package runeutil provides utility functions for tidying up incoming runes
// from Key messages.
package textarea

import (
	"unicode"
	"unicode/utf8"
)

// Sanitizer is a helper for bubble widgets that want to process
// Runes from input key messages.
type Sanitizer interface {
	// Sanitize removes control characters from runes in a KeyRunes
	// message, and optionally replaces newline/carriage return/tabs by a
	// specified character.
	//
	// The rune array is modified in-place if possible. In that case, the
	// returned slice is the original slice shortened after the control
	// characters have been removed/translated.
	Sanitize(runes []rune) []rune
}

// NewSanitizer constructs a rune sanitizer.
func NewSanitizer(opts ...Option) Sanitizer {
	s := sanitizer{
		replaceNewLine: []rune("\n"),
		replaceTab:     []rune("    "),
	}
	for _, o := range opts {
		s = o(s)
	}
	return &s
}

// Option is the type of option that can be passed to Sanitize().
type Option func(sanitizer) sanitizer

// ReplaceTabs replaces tabs by the specified string.
func ReplaceTabs(tabRepl string) Option {
	return func(s sanitizer) sanitizer {
		s.replaceTab = []rune(tabRepl)
		return s
	}
}

// ReplaceNewlines replaces newline characters by the specified string.
func ReplaceNewlines(nlRepl string) Option {
	return func(s sanitizer) sanitizer {
		s.replaceNewLine = []rune(nlRepl)
		return s
	}
}

func (s *sanitizer) Sanitize(runes []rune) []rune {
	// dstrunes are where we are storing the result.
	dstrunes := runes[:0:len(runes)]
	// copied indicates whether dstrunes is an alias of runes
	// or a copy. We need a copy when dst moves past src.
	// We use this as an optimization to avoid allocating
	// a new rune slice in the common case where the output
	// is smaller or equal to the input.
	copied := false

	for src := 0; src < len(runes); src++ {
		r := runes[src]

		// Check for escape sequence start (ESC or 0x1B)
		if r == 0x1B || r == '\x1b' {
			// Skip the entire escape sequence
			// Common patterns: ESC[...M, ESC[...m, ESC[<...
			seqEnd := src + 1
			for seqEnd < len(runes) {
				// Look for sequence terminator
				if runes[seqEnd] == 'M' || runes[seqEnd] == 'm' ||
					runes[seqEnd] == 'H' || runes[seqEnd] == 'J' ||
					runes[seqEnd] == 'K' || runes[seqEnd] == 'A' ||
					runes[seqEnd] == 'B' || runes[seqEnd] == 'C' ||
					runes[seqEnd] == 'D' || runes[seqEnd] == '~' {
					// Found terminator, skip entire sequence
					src = seqEnd
					break
				}
				// Safety: don't scan too far
				if seqEnd-src > 20 {
					// Probably not a valid escape sequence
					break
				}
				seqEnd++
			}
			continue
		}

		switch {
		case r == utf8.RuneError:
			// skip

		case r == '\r' || r == '\n':
			if len(dstrunes)+len(s.replaceNewLine) > src && !copied {
				dst := len(dstrunes)
				dstrunes = make([]rune, dst, len(runes)+len(s.replaceNewLine))
				copy(dstrunes, runes[:dst])
				copied = true
			}
			dstrunes = append(dstrunes, s.replaceNewLine...)

		case r == '\t':
			if len(dstrunes)+len(s.replaceTab) > src && !copied {
				dst := len(dstrunes)
				dstrunes = make([]rune, dst, len(runes)+len(s.replaceTab))
				copy(dstrunes, runes[:dst])
				copied = true
			}
			dstrunes = append(dstrunes, s.replaceTab...)

		case unicode.IsControl(r):
			// Other control characters: skip.

		default:
			// Keep the character.
			dstrunes = append(dstrunes, runes[src])
		}
	}
	return dstrunes
}

type sanitizer struct {
	replaceNewLine []rune
	replaceTab     []rune
}
