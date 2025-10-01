package viewport

import (
	tea "github.com/charmbracelet/bubbletea/v2"
	"math"
	"strings"
	"testing"
)

// TestScrollbarPrecisionDrift tests for precision loss over repeated operations
func TestScrollbarPrecisionDrift(t *testing.T) {
	m := New(WithWidth(80), WithHeight(24), WithScrollbar(true))
	m.SetContent(strings.Repeat("line\n", 1000))

	// Set to a specific position
	initialOffset := 500
	m.SetYOffset(initialOffset)

	// Get the percentage
	initialPercent := m.ScrollPercent()

	// Repeatedly convert back and forth
	for i := 0; i < 100; i++ {
		percent := m.ScrollPercent()
		m.SetYOffsetPercent(percent)
	}

	// Check for drift
	finalOffset := m.YOffset
	finalPercent := m.ScrollPercent()

	offsetDrift := math.Abs(float64(finalOffset - initialOffset))
	percentDrift := math.Abs(finalPercent - initialPercent)

	t.Logf("Initial offset: %d, Final offset: %d, Drift: %.2f", initialOffset, finalOffset, offsetDrift)
	t.Logf("Initial percent: %.6f, Final percent: %.6f, Drift: %.6f", initialPercent, finalPercent, percentDrift)

	// With fixed-point arithmetic, there should be NO drift
	if offsetDrift > 1.0 {
		t.Errorf("Offset drifted by %.2f pixels after 100 operations", offsetDrift)
	}
	if percentDrift > 0.001 {
		t.Errorf("Percent drifted by %.6f after 100 operations", percentDrift)
	}
}

// TestScrollbarPrecisionExtreme tests with extreme numbers of operations
func TestScrollbarPrecisionExtreme(t *testing.T) {
	m := New(WithWidth(80), WithHeight(24), WithScrollbar(true))
	m.SetContent(strings.Repeat("line\n", 10000))

	// Set to a problematic position (not evenly divisible)
	initialOffset := 3333
	m.SetYOffset(initialOffset)

	// Simulate 10000 scroll operations
	for i := 0; i < 10000; i++ {
		percent := m.ScrollPercent()
		m.SetYOffsetPercent(percent)
	}

	finalOffset := m.YOffset
	drift := math.Abs(float64(finalOffset - initialOffset))

	t.Logf("After 10000 operations: drift = %.2f pixels", drift)

	// With fixed-point arithmetic, drift should be minimal
	if drift > 1.0 {
		t.Errorf("Excessive drift after 10000 operations: %.2f pixels", drift)
	}
}

// TestScrollbarDragPrecision tests that dragging maintains precision
func TestScrollbarDragPrecision(t *testing.T) {
	m := New(WithWidth(80), WithHeight(40), WithScrollbar(true))
	m.SetContent(strings.Repeat("line\n", 1000))

	// Get scrollbar thumb position
	thumbPos, thumbSize := m.scrollbarThumbPosition()

	// Click on the thumb to start dragging
	clickY := thumbPos + thumbSize/2
	m = m.updateAsModel(tea.MouseClickMsg{X: m.Width() - 1, Y: clickY})

	// Verify dragging started
	if !m.scrollbarDragging {
		t.Fatal("Expected dragging to start")
	}

	// Record initial offset
	initialOffset := m.YOffset

	// Simulate many small drag movements
	for i := 0; i < 100; i++ {
		// Move up and down by small amounts
		if i%2 == 0 {
			m = m.updateAsModel(tea.MouseMotionMsg{X: m.Width() - 1, Y: clickY + 1})
		} else {
			m = m.updateAsModel(tea.MouseMotionMsg{X: m.Width() - 1, Y: clickY})
		}
	}

	// Return to original position
	m = m.updateAsModel(tea.MouseMotionMsg{X: m.Width() - 1, Y: clickY})

	// Release
	m = m.updateAsModel(tea.MouseReleaseMsg{})

	// The offset should return to near-initial value despite many small movements
	// This tests that fixed-point arithmetic prevents accumulation of rounding errors
	finalOffset := m.YOffset
	drift := math.Abs(float64(finalOffset - initialOffset))

	t.Logf("Initial offset: %d, Final offset after drag oscillation: %d, Drift: %.2f",
		initialOffset, finalOffset, drift)

	if drift > 2.0 {
		t.Errorf("Offset drifted by %.2f pixels after drag oscillation", drift)
	}
}
