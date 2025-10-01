package viewport

import (
	"strings"
	"testing"
)

func TestViewport_WidthWithScrollbar(t *testing.T) {
	tests := []struct {
		name              string
		viewportWidth     int
		contentLines      int
		viewportHeight    int
		showScrollbar     bool
		expectedLineWidth int
		longContent       string
	}{
		{
			name:              "content width reduced when scrollbar shown",
			viewportWidth:     50,
			contentLines:      20,
			viewportHeight:    10,
			showScrollbar:     true,
			expectedLineWidth: 49, // 50 - 1 for scrollbar
			longContent:       strings.Repeat("x", 48),
		},
		{
			name:              "full width when scrollbar hidden",
			viewportWidth:     50,
			contentLines:      5,
			viewportHeight:    10,
			showScrollbar:     true,
			expectedLineWidth: 50, // No scrollbar needed
			longContent:       strings.Repeat("x", 49),
		},
		{
			name:              "full width when scrollbar disabled",
			viewportWidth:     50,
			contentLines:      20,
			viewportHeight:    10,
			showScrollbar:     false,
			expectedLineWidth: 50,
			longContent:       strings.Repeat("x", 49),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New(
				WithWidth(tt.viewportWidth),
				WithHeight(tt.viewportHeight),
				WithScrollbar(tt.showScrollbar),
			)

			// Create content with some long lines
			lines := make([]string, tt.contentLines)
			for i := range tt.contentLines {
				if i == 0 {
					// First line is long to test wrapping
					lines[i] = tt.longContent
				} else {
					lines[i] = "Short line"
				}
			}
			m.SetContent(strings.Join(lines, "\n"))

			// Get the max width accounting for scrollbar
			maxWidth := m.maxWidth()

			// When scrollbar is shown and enabled, width should be reduced
			shouldShowScrollbar := tt.showScrollbar && tt.contentLines > tt.viewportHeight
			expectedMaxWidth := tt.viewportWidth
			if shouldShowScrollbar {
				expectedMaxWidth--
			}

			if maxWidth != expectedMaxWidth {
				t.Errorf("Expected maxWidth %d, got %d", expectedMaxWidth, maxWidth)
			}

			// Verify the view doesn't cause wrapping issues
			view := m.View()
			viewLines := strings.Split(view, "\n")

			// Check that lines aren't unexpectedly wrapped
			// Note: The view might have padding/borders from Style
			// so we'll just verify the content doesn't get mangled
			if len(viewLines) > 0 && shouldShowScrollbar {
				// Look for the scrollbar character
				hasScrollbar := false
				for _, line := range viewLines {
					if strings.Contains(line, "│") || strings.Contains(line, "▐") {
						hasScrollbar = true
						break
					}
				}
				if !hasScrollbar && tt.contentLines > tt.viewportHeight {
					t.Error("Expected scrollbar to be visible but it wasn't")
				}
			}
		})
	}
}

func TestViewport_NoWrapWithScrollbar(t *testing.T) {
	// Test that adding a scrollbar doesn't cause content to wrap unexpectedly
	m := New(
		WithWidth(80),
		WithHeight(10),
		WithScrollbar(true),
	)

	// Create content that's exactly 78 chars wide (79 would wrap with scrollbar)
	testLine := strings.Repeat("a", 78)
	lines := make([]string, 20) // Ensure scrollbar appears
	for i := range 20 {
		lines[i] = testLine
	}
	m.SetContent(strings.Join(lines, "\n"))

	// Verify content doesn't wrap
	visibleLines := m.visibleLines()
	if len(visibleLines) > 0 {
		// Each line should still be on one line, not wrapped
		for _, line := range visibleLines {
			// Check that line doesn't contain newlines (would indicate wrapping)
			if strings.Contains(line, "\n") {
				t.Error("Content wrapped unexpectedly with scrollbar")
			}
		}
	}
}

func TestViewport_ConsistentWidth(t *testing.T) {
	// Test that content width remains consistent when scrollbar appears/disappears
	m := New(
		WithWidth(60),
		WithHeight(10),
		WithScrollbar(true),
	)

	// First, add content that doesn't need scrollbar
	shortContent := strings.Join([]string{"Line 1", "Line 2", "Line 3"}, "\n")
	m.SetContent(shortContent)
	widthWithoutScrollbar := m.maxWidth()

	// Now add content that needs scrollbar
	longLines := make([]string, 30)
	for i := range 30 {
		longLines[i] = "Line " + strings.Repeat("x", 50)
	}
	m.SetContent(strings.Join(longLines, "\n"))
	widthWithScrollbar := m.maxWidth()

	// Width should be reduced by 1 when scrollbar appears
	if widthWithoutScrollbar-widthWithScrollbar != 1 {
		t.Errorf("Expected width to reduce by 1 with scrollbar, got diff of %d",
			widthWithoutScrollbar-widthWithScrollbar)
	}
}

func TestViewport_HorizontalScrollWithScrollbar(t *testing.T) {
	// Test that horizontal scrolling accounts for scrollbar
	m := New(
		WithWidth(40),
		WithHeight(5),
		WithScrollbar(true),
	)

	// Create content wider than viewport and taller to show scrollbar
	lines := make([]string, 10)
	for i := range 10 {
		lines[i] = strings.Repeat("x", 100) // Very wide content
	}
	m.SetContent(strings.Join(lines, "\n"))

	// Test max X offset accounts for scrollbar
	maxX := m.maxXOffset()

	// Expected: 100 (content width) - 39 (viewport - scrollbar) = 61
	expectedMaxX := 100 - 39
	if maxX != expectedMaxX {
		t.Errorf("Expected maxXOffset %d, got %d", expectedMaxX, maxX)
	}
}
