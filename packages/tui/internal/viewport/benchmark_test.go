package viewport

import (
	"strings"
	"testing"
)

func BenchmarkScrollbarRendering(b *testing.B) {
	m := New(WithWidth(120), WithHeight(40), WithScrollbar(true))
	content := strings.Repeat("This is a line of content that needs scrollbar rendering\n", 1000)
	m.SetContent(content)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.View()
	}
}

func BenchmarkScrollbarRenderingWithScrolling(b *testing.B) {
	m := New(WithWidth(120), WithHeight(40), WithScrollbar(true))
	content := strings.Repeat("Line of text for scrollbar testing\n", 1000)
	m.SetContent(content)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.LineDown(1)
		_ = m.View()
	}
}

func BenchmarkAddScrollbar(b *testing.B) {
	m := New(WithWidth(80), WithHeight(24), WithScrollbar(true))
	content := strings.Repeat("Test line content\n", 50)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.addScrollbar(content, 24)
	}
}

func BenchmarkAddScrollbarLongLines(b *testing.B) {
	m := New(WithWidth(80), WithHeight(24), WithScrollbar(true))
	// Long lines that need truncation
	content := strings.Repeat(strings.Repeat("x", 200)+"\n", 50)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.addScrollbar(content, 24)
	}
}
