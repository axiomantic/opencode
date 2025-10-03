package viewport

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
)

func TestScrollbar_Visibility(t *testing.T) {
	tests := []struct {
		name           string
		viewportHeight int
		contentLines   int
		showScrollbar  bool
		expectVisible  bool
	}{
		{
			name:           "scrollbar visible when content exceeds viewport",
			viewportHeight: 5,
			contentLines:   10,
			showScrollbar:  true,
			expectVisible:  true,
		},
		{
			name:           "scrollbar hidden when content fits viewport",
			viewportHeight: 10,
			contentLines:   5,
			showScrollbar:  true,
			expectVisible:  false,
		},
		{
			name:           "scrollbar hidden when disabled",
			viewportHeight: 5,
			contentLines:   10,
			showScrollbar:  false,
			expectVisible:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New(
				WithWidth(20),
				WithHeight(tt.viewportHeight),
				WithScrollbar(tt.showScrollbar),
			)

			// Generate content
			lines := make([]string, tt.contentLines)
			for i := range tt.contentLines {
				lines[i] = "Line"
			}
			m.SetContent(strings.Join(lines, "\n"))

			view := m.View()

			hasScrollbarChars := strings.Contains(view, "│") ||
				strings.Contains(view, "▐") ||
				strings.Contains(view, "█")

			if tt.expectVisible && !hasScrollbarChars {
				t.Error("Expected scrollbar to be visible but it wasn't")
			}
			if !tt.expectVisible && hasScrollbarChars {
				t.Error("Expected scrollbar to be hidden but it was visible")
			}
		})
	}
}

func TestScrollbar_ThumbPosition(t *testing.T) {
	tests := []struct {
		name              string
		totalLines        int
		viewportHeight    int
		scrollOffset      int
		expectedThumbPos  int
		expectedThumbSize int
	}{
		{
			name:              "thumb at top when not scrolled",
			totalLines:        20,
			viewportHeight:    10,
			scrollOffset:      0,
			expectedThumbPos:  0,
			expectedThumbSize: 5, // 10/20 * 10 = 5
		},
		{
			name:              "thumb at middle when scrolled halfway",
			totalLines:        20,
			viewportHeight:    10,
			scrollOffset:      5,
			expectedThumbPos:  2, // 5/10 * 5 = 2.5 -> 2
			expectedThumbSize: 5,
		},
		{
			name:              "thumb at bottom when fully scrolled",
			totalLines:        20,
			viewportHeight:    10,
			scrollOffset:      10,
			expectedThumbPos:  5, // (10-5) = 5
			expectedThumbSize: 5,
		},
		{
			name:              "full height thumb when content fits",
			totalLines:        5,
			viewportHeight:    10,
			scrollOffset:      0,
			expectedThumbPos:  0,
			expectedThumbSize: 10,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New(WithWidth(20), WithHeight(tt.viewportHeight))

			// Generate content
			lines := make([]string, tt.totalLines)
			for i := range tt.totalLines {
				lines[i] = "Line"
			}
			m.SetContent(strings.Join(lines, "\n"))

			// Set scroll position
			m.SetYOffset(tt.scrollOffset)

			pos, size := m.scrollbarThumbPosition()

			// Allow for small rounding differences
			if pos < tt.expectedThumbPos-1 || pos > tt.expectedThumbPos+1 {
				t.Errorf("Expected thumb position ~%d, got %d", tt.expectedThumbPos, pos)
			}
			if size < tt.expectedThumbSize-1 || size > tt.expectedThumbSize+1 {
				t.Errorf("Expected thumb size ~%d, got %d", tt.expectedThumbSize, size)
			}
		})
	}
}

func TestScrollbar_MouseInteraction(t *testing.T) {
	tests := []struct {
		name             string
		action           string // "click", "drag"
		mouseX           int
		mouseY           int
		expectedScrolled bool
		expectedDragging bool
	}{
		{
			name:             "click on scrollbar track jumps to position and enables dragging",
			action:           "click",
			mouseX:           19,
			mouseY:           5,
			expectedScrolled: true,
			expectedDragging: true, // Now enables dragging for immediate drag support
		},
		{
			name:             "click outside scrollbar does nothing",
			action:           "click",
			mouseX:           10,
			mouseY:           5,
			expectedScrolled: false,
			expectedDragging: false,
		},
		{
			name:             "drag on scrollbar starts dragging",
			action:           "drag",
			mouseX:           19,
			mouseY:           2,
			expectedScrolled: true,
			expectedDragging: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New(WithWidth(20), WithHeight(10), WithScrollbar(true))

			// Add content that exceeds viewport
			lines := make([]string, 30)
			for i := range 30 {
				lines[i] = "Line"
			}
			m.SetContent(strings.Join(lines, "\n"))

			initialOffset := m.YOffset

			switch tt.action {
			case "click":
				msg := tea.MouseClickMsg{
					X:      tt.mouseX,
					Y:      tt.mouseY,
					Button: tea.MouseLeft,
				}
				m = m.updateAsModel(msg)

			case "drag":
				// Start drag
				clickMsg := tea.MouseClickMsg{
					X:      tt.mouseX,
					Y:      tt.mouseY,
					Button: tea.MouseLeft,
				}
				m = m.updateAsModel(clickMsg)

				// Move mouse
				motionMsg := tea.MouseMotionMsg{
					X: tt.mouseX,
					Y: tt.mouseY + 3,
				}
				m = m.updateAsModel(motionMsg)
			}

			scrolled := m.YOffset != initialOffset
			if scrolled != tt.expectedScrolled {
				t.Errorf("Expected scrolled=%v, got %v (offset changed from %d to %d)",
					tt.expectedScrolled, scrolled, initialOffset, m.YOffset)
			}

			if m.scrollbarDragging != tt.expectedDragging {
				t.Errorf("Expected dragging=%v, got %v", tt.expectedDragging, m.scrollbarDragging)
			}
		})
	}
}

func TestScrollbar_DragAndRelease(t *testing.T) {
	m := New(WithWidth(20), WithHeight(10), WithScrollbar(true))

	// Add content
	lines := make([]string, 30)
	for i := range 30 {
		lines[i] = "Line"
	}
	m.SetContent(strings.Join(lines, "\n"))

	// Start drag
	clickMsg := tea.MouseClickMsg{X: 19, Y: 2, Button: tea.MouseLeft}
	m = m.updateAsModel(clickMsg)

	if !m.scrollbarDragging {
		t.Error("Expected scrollbarDragging to be true after click")
	}

	// Drag to new position
	motionMsg := tea.MouseMotionMsg{X: 19, Y: 8}
	m = m.updateAsModel(motionMsg)

	dragOffset := m.YOffset

	// Release
	releaseMsg := tea.MouseReleaseMsg{X: 19, Y: 8, Button: tea.MouseLeft}
	m = m.updateAsModel(releaseMsg)

	if m.scrollbarDragging {
		t.Error("Expected scrollbarDragging to be false after release")
	}

	if m.YOffset != dragOffset {
		t.Errorf("Scroll position changed after release: %d -> %d", dragOffset, m.YOffset)
	}
}

func TestScrollbar_WithAdaptiveScroll(t *testing.T) {
	m := New(
		WithWidth(20),
		WithHeight(10),
		WithScrollbar(true),
	)

	// Enable adaptive scrolling
	m.AdaptiveScrollEnabled = true
	m.AdaptiveConfig = &AdaptiveScrollConfig{
		MaxMultiplier: 5.0,
		Acceleration:  0.5,
		Deceleration:  0.95,
		TimeWindow:    50,
	}
	m.MouseWheelDelta = 3

	// Add content
	lines := make([]string, 50)
	for i := range 50 {
		lines[i] = "Line"
	}
	m.SetContent(strings.Join(lines, "\n"))

	// Test that mouse wheel is ignored while dragging scrollbar
	// Start dragging - click on thumb position
	thumbPos, _ := m.scrollbarThumbPosition()
	clickMsg := tea.MouseClickMsg{X: 19, Y: thumbPos, Button: tea.MouseLeft}
	m = m.updateAsModel(clickMsg)

	if !m.scrollbarDragging {
		t.Fatal("Expected to be dragging")
	}

	initialOffset := m.YOffset

	// Try to scroll with mouse wheel (should be ignored)
	wheelMsg := tea.MouseWheelMsg{Button: tea.MouseWheelDown}
	m = m.updateAsModel(wheelMsg)

	if m.YOffset != initialOffset {
		t.Error("Mouse wheel should be ignored while dragging scrollbar")
	}

	// Release drag
	releaseMsg := tea.MouseReleaseMsg{X: 19, Y: 2, Button: tea.MouseLeft}
	m = m.updateAsModel(releaseMsg)

	// Now mouse wheel should work
	m = m.updateAsModel(wheelMsg)
	if m.YOffset == initialOffset {
		t.Error("Mouse wheel should work after releasing scrollbar")
	}
}

func TestScrollbar_SetYOffsetPercent(t *testing.T) {
	tests := []struct {
		name           string
		percent        float64
		totalLines     int
		viewportHeight int
		expectedOffset int
	}{
		{
			name:           "0% scrolls to top",
			percent:        0.0,
			totalLines:     30,
			viewportHeight: 10,
			expectedOffset: 0,
		},
		{
			name:           "100% scrolls to bottom",
			percent:        1.0,
			totalLines:     30,
			viewportHeight: 10,
			expectedOffset: 20, // 30 - 10
		},
		{
			name:           "50% scrolls to middle",
			percent:        0.5,
			totalLines:     30,
			viewportHeight: 10,
			expectedOffset: 10,
		},
		{
			name:           "negative percent clamps to 0",
			percent:        -0.5,
			totalLines:     30,
			viewportHeight: 10,
			expectedOffset: 0,
		},
		{
			name:           "over 100% clamps to max",
			percent:        1.5,
			totalLines:     30,
			viewportHeight: 10,
			expectedOffset: 20,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New(WithWidth(20), WithHeight(tt.viewportHeight))

			// Generate content
			lines := make([]string, tt.totalLines)
			for i := range tt.totalLines {
				lines[i] = "Line"
			}
			m.SetContent(strings.Join(lines, "\n"))

			m.SetYOffsetPercent(tt.percent)

			if m.YOffset != tt.expectedOffset {
				t.Errorf("Expected offset %d for %.1f%%, got %d",
					tt.expectedOffset, tt.percent*100, m.YOffset)
			}
		})
	}
}

func TestScrollbar_Styling(t *testing.T) {
	trackStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("100"))
	thumbStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("200"))

	m := New(
		WithWidth(20),
		WithHeight(5),
		WithScrollbar(true),
		WithScrollbarStyles(trackStyle, thumbStyle),
	)

	// Verify styles are set
	trackRender := m.ScrollbarStyle.Render("│")
	thumbRender := m.ScrollbarThumbStyle.Render("▐")

	expectedTrack := trackStyle.Render("│")
	expectedThumb := thumbStyle.Render("▐")

	if trackRender != expectedTrack {
		t.Error("ScrollbarStyle not applied correctly")
	}

	if thumbRender != expectedThumb {
		t.Error("ScrollbarThumbStyle not applied correctly")
	}
}

func TestScrollbar_Helpers(t *testing.T) {
	t.Run("isOnScrollbar", func(t *testing.T) {
		m := New(WithWidth(20), WithHeight(10), WithScrollbar(true))

		tests := []struct {
			x, y     int
			expected bool
		}{
			{19, 5, true},   // On scrollbar
			{18, 5, true},   // Near scrollbar (within tolerance)
			{17, 5, false},  // Left of scrollbar tolerance
			{10, 5, false},  // Far from scrollbar
			{19, 10, false}, // Below viewport
		}

		for _, tt := range tests {
			result := m.isOnScrollbar(tt.x, tt.y)
			if result != tt.expected {
				t.Errorf("isOnScrollbar(%d, %d) = %v, want %v", tt.x, tt.y, result, tt.expected)
			}
		}
	})

	t.Run("isOnScrollbar respects ShowScrollbar", func(t *testing.T) {
		m := New(WithWidth(20), WithHeight(10), WithScrollbar(false))

		if m.isOnScrollbar(19, 5) {
			t.Error("isOnScrollbar should return false when ShowScrollbar is false")
		}
	})
}

func BenchmarkScrollbar_Render(b *testing.B) {
	m := New(WithWidth(80), WithHeight(24), WithScrollbar(true))

	// Add substantial content
	lines := make([]string, 1000)
	for i := range 1000 {
		lines[i] = strings.Repeat("x", 70)
	}
	m.SetContent(strings.Join(lines, "\n"))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.View()
	}
}

func BenchmarkScrollbar_MouseInteraction(b *testing.B) {
	m := New(WithWidth(80), WithHeight(24), WithScrollbar(true))

	// Add content
	lines := make([]string, 100)
	for i := range 100 {
		lines[i] = "Line"
	}
	m.SetContent(strings.Join(lines, "\n"))

	msg := tea.MouseClickMsg{X: 79, Y: 12, Button: tea.MouseLeft}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.updateAsModel(msg)
	}
}
