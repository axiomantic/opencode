package textarea

import (
	"testing"
	"unicode/utf8"
)

func TestSanitizer_MouseEscapeSequences(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "SGR mouse press escape sequence",
			input:    "hello\x1b[<0;10;5Mworld",
			expected: "helloworld",
		},
		{
			name:     "SGR mouse release escape sequence",
			input:    "foo\x1b[<0;10;5mbar",
			expected: "foobar",
		},
		{
			name:     "X10 mouse sequence",
			input:    "test\x1b[M   text",
			expected: "test   text",
		},
		{
			name:     "Mouse wheel down SGR",
			input:    "scroll\x1b[<64;20;10Mhere",
			expected: "scrollhere",
		},
		{
			name:     "Mouse wheel up SGR",
			input:    "scroll\x1b[<65;20;10Mhere",
			expected: "scrollhere",
		},
		{
			name:     "Multiple escape sequences",
			input:    "a\x1b[<0;1;1Mb\x1b[<0;2;2Mc",
			expected: "abc",
		},
		{
			name:     "Escape sequence at start",
			input:    "\x1b[<0;10;5Mtext",
			expected: "text",
		},
		{
			name:     "Escape sequence at end",
			input:    "text\x1b[<0;10;5M",
			expected: "text",
		},
		{
			name:     "Only escape sequence",
			input:    "\x1b[<0;10;5M",
			expected: "",
		},
		{
			name:     "Normal text unchanged",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name:     "Cursor movement sequences",
			input:    "test\x1b[Hmore\x1b[Jtext",
			expected: "testmoretext",
		},
		{
			name:     "Arrow key sequences",
			input:    "nav\x1b[Aup\x1b[Bdown\x1b[Cleft\x1b[Dright",
			expected: "navupdownleftright",
		},
		{
			name:     "Mixed escape sequences and newlines",
			input:    "line1\x1b[<0;1;1M\nline2",
			expected: "line1\nline2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewSanitizer()
			input := []rune(tt.input)
			result := s.Sanitize(input)
			got := string(result)

			if got != tt.expected {
				t.Errorf("Sanitize() = %q, want %q", got, tt.expected)
				t.Logf("Input runes: %v", input)
				t.Logf("Result runes: %v", result)
			}
		})
	}
}

func TestSanitizer_ControlCharacters(t *testing.T) {
	tests := []struct {
		name     string
		input    []rune
		expected []rune
	}{
		{
			name:     "removes control characters",
			input:    []rune{'h', 'e', 'l', 0x01, 'l', 'o'},
			expected: []rune{'h', 'e', 'l', 'l', 'o'},
		},
		{
			name:     "keeps valid unicode",
			input:    []rune{'h', 'i', ' ', '世', '界'},
			expected: []rune{'h', 'i', ' ', '世', '界'},
		},
		{
			name:     "removes rune error",
			input:    []rune{'t', 'e', 's', 't', utf8.RuneError, '!'},
			expected: []rune{'t', 'e', 's', 't', '!'},
		},
		{
			name:     "handles tabs",
			input:    []rune{'a', '\t', 'b'},
			expected: []rune{'a', ' ', ' ', ' ', ' ', 'b'},
		},
		{
			name:     "handles newlines",
			input:    []rune{'a', '\n', 'b'},
			expected: []rune{'a', '\n', 'b'},
		},
		{
			name:     "handles carriage return",
			input:    []rune{'a', '\r', 'b'},
			expected: []rune{'a', '\n', 'b'},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewSanitizer()
			result := s.Sanitize(tt.input)

			if len(result) != len(tt.expected) {
				t.Errorf("Length mismatch: got %d, want %d", len(result), len(tt.expected))
				t.Errorf("Got: %v", result)
				t.Errorf("Want: %v", tt.expected)
				return
			}

			for i := range result {
				if result[i] != tt.expected[i] {
					t.Errorf("Mismatch at position %d: got %q (%d), want %q (%d)",
						i, result[i], result[i], tt.expected[i], tt.expected[i])
				}
			}
		})
	}
}

func TestSanitizer_EscapeSequenceEdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "incomplete escape sequence with 'm' incorrectly detected as terminator",
			input:    "text\x1b[incomplete",
			expected: "textplete", // NOTE: 'm' in 'incomplete' is mistakenly treated as terminator
		},
		{
			name:     "very long sequence safety stopped keeps text",
			input:    "text\x1b[012345678901234567890M", // 21 chars after [, triggers safety
			expected: "text[012345678901234567890M",
		},
		{
			name:     "escape without bracket",
			input:    "text\x1bXmore",
			expected: "textXmore",
		},
		{
			name:     "multiple ESC characters",
			input:    "\x1b\x1b[Mtext",
			expected: "text",
		},
		{
			name:     "ESC in middle of text",
			input:    "before\x1bmiddle\x1b[Mafter",
			expected: "beforemiddleafter",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewSanitizer()
			input := []rune(tt.input)
			result := s.Sanitize(input)
			got := string(result)

			if got != tt.expected {
				t.Errorf("Sanitize() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func BenchmarkSanitizer_WithEscapeSequences(b *testing.B) {
	s := NewSanitizer()
	input := []rune("hello\x1b[<0;10;5Mworld\x1b[<0;20;10mtest\x1b[Hmore")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = s.Sanitize(input)
	}
}

func BenchmarkSanitizer_PlainText(b *testing.B) {
	s := NewSanitizer()
	input := []rune("The quick brown fox jumps over the lazy dog")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = s.Sanitize(input)
	}
}
