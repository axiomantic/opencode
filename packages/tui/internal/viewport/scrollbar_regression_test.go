package viewport

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

// TestScrollbar_NoViewportBreakage ensures that enabling scrollbar doesn't break
// viewport rendering (regression test for the wrapping issue)
func TestScrollbar_NoViewportBreakage(t *testing.T) {
	tests := []struct {
		name           string
		viewportWidth  int
		viewportHeight int
		contentWidth   int
		contentLines   int
		scrollbarOn    bool
	}{
		{
			name:           "wide content with scrollbar",
			viewportWidth:  80,
			viewportHeight: 10,
			contentWidth:   78, // Just under viewport width
			contentLines:   30,
			scrollbarOn:    true,
		},
		{
			name:           "exact width content with scrollbar",
			viewportWidth:  60,
			viewportHeight: 8,
			contentWidth:   59, // Exactly viewport width - 1
			contentLines:   20,
			scrollbarOn:    true,
		},
		{
			name:           "narrow content with scrollbar",
			viewportWidth:  100,
			viewportHeight: 15,
			contentWidth:   50,
			contentLines:   50,
			scrollbarOn:    true,
		},
		{
			name:           "content without scrollbar as control",
			viewportWidth:  80,
			viewportHeight: 10,
			contentWidth:   78,
			contentLines:   30,
			scrollbarOn:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New(
				WithWidth(tt.viewportWidth),
				WithHeight(tt.viewportHeight),
				WithScrollbar(tt.scrollbarOn),
			)

			// Create content with specific width
			testLine := strings.Repeat("x", tt.contentWidth)
			lines := make([]string, tt.contentLines)
			for i := range tt.contentLines {
				lines[i] = testLine
			}
			m.SetContent(strings.Join(lines, "\n"))

			// Get visible lines
			visible := m.visibleLines()

			// Check that visible lines don't exceed expected width
			maxExpectedWidth := tt.viewportWidth
			if tt.scrollbarOn && tt.contentLines > tt.viewportHeight {
				maxExpectedWidth-- // Account for scrollbar
			}

			for i, line := range visible {
				lineWidth := ansi.StringWidth(line)
				// Allow for some styling/padding, but not excessive
				if lineWidth > maxExpectedWidth+5 {
					t.Errorf("Line %d width %d exceeds expected max %d",
						i, lineWidth, maxExpectedWidth)
				}

				// Check for unexpected line breaks (wrapping)
				if strings.Contains(line, "\n") {
					t.Errorf("Line %d contains unexpected newline (wrapping)", i)
				}
			}

			// Render the full view
			view := m.View()

			// Basic sanity checks
			if view == "" {
				t.Error("View should not be empty")
			}

			// Check that scrollbar appears when expected
			if tt.scrollbarOn && tt.contentLines > tt.viewportHeight {
				if !strings.Contains(view, "│") && !strings.Contains(view, "▐") {
					t.Error("Expected scrollbar to be visible in view")
				}
			}
		})
	}
}

// TestScrollbar_InteractiveBehavior tests click and drag interactions
func TestScrollbar_InteractiveBehavior(t *testing.T) {
	t.Run("clicking on track moves thumb to position", func(t *testing.T) {
		m := New(WithWidth(40), WithHeight(10), WithScrollbar(true))

		// Add content
		lines := make([]string, 30)
		for i := range 30 {
			lines[i] = "Line " + strings.Repeat("x", 20)
		}
		m.SetContent(strings.Join(lines, "\n"))

		// Click at middle of scrollbar track
		clickY := 5
		msg := tea.MouseClickMsg{
			X:      39, // Right edge
			Y:      clickY,
			Button: tea.MouseLeft,
		}

		m = m.updateAsModel(msg)

		// Verify scroll position changed appropriately
		// With +1 offset adjustment, clicking at Y=5 moves thumb to Y=6
		expectedScrollPercent := 0.8 // Approximately 80% (click at 5 + 1 offset)
		actualPercent := m.ScrollPercent()

		if actualPercent < expectedScrollPercent-0.2 || actualPercent > expectedScrollPercent+0.2 {
			t.Errorf("Expected scroll percent around %.1f, got %.1f",
				expectedScrollPercent, actualPercent)
		}
	})

	t.Run("dragging thumb maintains relative position", func(t *testing.T) {
		m := New(WithWidth(40), WithHeight(10), WithScrollbar(true))

		// Add content
		lines := make([]string, 30)
		for i := range 30 {
			lines[i] = "Line"
		}
		m.SetContent(strings.Join(lines, "\n"))

		// Set initial scroll position
		m.SetYOffsetPercent(0.3)

		// Get thumb position
		thumbPos, _ := m.scrollbarThumbPosition()

		// Start dragging from middle of thumb
		clickMsg := tea.MouseClickMsg{
			X:      39,
			Y:      thumbPos + 1, // Click in middle of thumb
			Button: tea.MouseLeft,
		}
		m = m.updateAsModel(clickMsg)

		if !m.scrollbarDragging {
			t.Fatal("Should be dragging after clicking on thumb")
		}

		// Drag down by 2 positions
		motionMsg := tea.MouseMotionMsg{
			X: 39,
			Y: thumbPos + 3,
		}
		m = m.updateAsModel(motionMsg)

		// Check that scroll position increased
		newPercent := m.ScrollPercent()
		if newPercent <= 0.3 {
			t.Error("Scroll position should increase when dragging down")
		}

		// Release
		releaseMsg := tea.MouseReleaseMsg{
			X:      39,
			Y:      thumbPos + 3,
			Button: tea.MouseLeft,
		}
		m = m.updateAsModel(releaseMsg)

		if m.scrollbarDragging {
			t.Error("Should not be dragging after release")
		}
	})

	t.Run("clicking on thumb doesn't jump", func(t *testing.T) {
		m := New(WithWidth(40), WithHeight(10), WithScrollbar(true))

		// Add content and set position
		lines := make([]string, 30)
		for i := range 30 {
			lines[i] = "Line"
		}
		m.SetContent(strings.Join(lines, "\n"))
		m.SetYOffsetPercent(0.5)

		initialOffset := m.YOffset
		thumbPos, _ := m.scrollbarThumbPosition()

		// Click on thumb
		msg := tea.MouseClickMsg{
			X:      39,
			Y:      thumbPos,
			Button: tea.MouseLeft,
		}
		m = m.updateAsModel(msg)

		// Position shouldn't change just from clicking
		if m.YOffset != initialOffset {
			t.Errorf("Clicking on thumb changed position from %d to %d",
				initialOffset, m.YOffset)
		}

		// But should be ready to drag
		if !m.scrollbarDragging {
			t.Error("Should be in dragging state after clicking thumb")
		}
	})
}

// TestScrollbar_EdgeCases tests edge cases and boundary conditions
func TestScrollbar_EdgeCases(t *testing.T) {
	t.Run("scrollbar with single line content", func(t *testing.T) {
		m := New(WithWidth(40), WithHeight(10), WithScrollbar(true))
		m.SetContent("Single line")

		// Scrollbar shouldn't appear
		view := m.View()
		if strings.Contains(view, "│") {
			t.Error("Scrollbar shouldn't appear for content that fits")
		}

		// Clicking where scrollbar would be does nothing
		msg := tea.MouseClickMsg{X: 39, Y: 5, Button: tea.MouseLeft}
		initialOffset := m.YOffset
		m = m.updateAsModel(msg)

		if m.YOffset != initialOffset {
			t.Error("Click shouldn't affect scroll when no scrollbar")
		}
	})

	t.Run("scrollbar with exactly viewport height content", func(t *testing.T) {
		m := New(WithWidth(40), WithHeight(5), WithScrollbar(true))

		lines := make([]string, 5)
		for i := range 5 {
			lines[i] = "Line"
		}
		m.SetContent(strings.Join(lines, "\n"))

		// Scrollbar shouldn't appear
		view := m.View()
		if strings.Contains(view, "│") {
			t.Error("Scrollbar shouldn't appear when content exactly fits")
		}
	})

	t.Run("drag beyond viewport bounds", func(t *testing.T) {
		m := New(WithWidth(40), WithHeight(10), WithScrollbar(true))

		// Add content
		lines := make([]string, 30)
		for i := range 30 {
			lines[i] = "Line"
		}
		m.SetContent(strings.Join(lines, "\n"))

		// Start dragging
		thumbPos, _ := m.scrollbarThumbPosition()
		clickMsg := tea.MouseClickMsg{X: 39, Y: thumbPos, Button: tea.MouseLeft}
		m = m.updateAsModel(clickMsg)

		// Drag way above viewport
		motionMsg := tea.MouseMotionMsg{X: 39, Y: -10}
		m = m.updateAsModel(motionMsg)

		if m.YOffset != 0 {
			t.Errorf("Dragging above viewport should scroll to top, got offset %d", m.YOffset)
		}

		// Drag way below viewport
		motionMsg = tea.MouseMotionMsg{X: 39, Y: 100}
		m = m.updateAsModel(motionMsg)

		if m.YOffset != m.maxYOffset() {
			t.Errorf("Dragging below viewport should scroll to bottom, got offset %d, max %d",
				m.YOffset, m.maxYOffset())
		}
	})
}

// BenchmarkScrollbar_InteractivePerformance benchmarks interactive scrollbar operations
func BenchmarkScrollbar_InteractivePerformance(b *testing.B) {
	m := New(WithWidth(80), WithHeight(24), WithScrollbar(true))

	// Add substantial content
	lines := make([]string, 1000)
	for i := range 1000 {
		lines[i] = strings.Repeat("x", 70)
	}
	m.SetContent(strings.Join(lines, "\n"))

	// Benchmark click and drag operations
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Click on track
		clickMsg := tea.MouseClickMsg{X: 79, Y: 12, Button: tea.MouseLeft}
		m = m.updateAsModel(clickMsg)

		// Drag
		motionMsg := tea.MouseMotionMsg{X: 79, Y: 15}
		m = m.updateAsModel(motionMsg)

		// Release
		releaseMsg := tea.MouseReleaseMsg{X: 79, Y: 15, Button: tea.MouseLeft}
		m = m.updateAsModel(releaseMsg)
	}
}
