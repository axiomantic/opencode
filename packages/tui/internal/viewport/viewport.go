package viewport

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

const (
	defaultHeight         = 1
	defaultWidth          = 1
	defaultVerticalStep   = 1
	defaultHorizontalStep = 6
	fixedPointScale       = 1000 // For fixed-point arithmetic to prevent float drift

	// Adaptive scroll constants
	baseVelocity            = 1.0
	velocitySmoothingFactor = 0.7 // Lower values = faster response, higher values = smoother
	smoothstepFactor1       = 3.0 // Smoothstep coefficient
	smoothstepFactor2       = 2.0 // Smoothstep coefficient
	decayTimeMultiplier     = 2   // Multiplier for decay time calculation

	// Scrollbar constants
	scrollbarClickColumns  = 2 // Number of columns from right edge that count as scrollbar clicks
	defaultMouseWheelDelta = 3 // Default number of lines to scroll with mouse wheel
)

// Fixed-point arithmetic helpers to prevent float precision loss
func toFixed(f float64) int64 {
	return int64(f * fixedPointScale)
}

func fromFixed(i int64) float64 {
	return float64(i) / fixedPointScale
}

func fixedMultiply(a int64, b int64) int64 {
	return (a * b) / fixedPointScale
}

// AdaptiveScrollConfig contains configuration for adaptive scroll speed
type AdaptiveScrollConfig struct {
	MaxMultiplier float64
	Acceleration  float64
	Deceleration  float64
	TimeWindow    int64 // milliseconds
}

// Validate checks if the adaptive scroll configuration values are within reasonable bounds
func (c *AdaptiveScrollConfig) Validate() error {
	if c == nil {
		return nil
	}

	if c.MaxMultiplier < baseVelocity {
		return fmt.Errorf("MaxMultiplier must be >= %.1f, got %f", baseVelocity, c.MaxMultiplier)
	}
	if c.MaxMultiplier > 20.0 {
		return fmt.Errorf("MaxMultiplier must be <= 20.0, got %f", c.MaxMultiplier)
	}

	if c.Acceleration < 0 || c.Acceleration > 2.0 {
		return fmt.Errorf("Acceleration must be between 0 and 2.0, got %f", c.Acceleration)
	}

	if c.Deceleration < 0 || c.Deceleration > baseVelocity {
		return fmt.Errorf("Deceleration must be between 0 and %.1f, got %f", baseVelocity, c.Deceleration)
	}

	if c.TimeWindow < 10 || c.TimeWindow > 500 {
		return fmt.Errorf("TimeWindow must be between 10ms and 500ms, got %d", c.TimeWindow)
	}

	return nil
}

// adaptiveScrollState tracks the current state of adaptive scrolling
type adaptiveScrollState struct {
	lastEventTime   time.Time
	currentVelocity float64
}

// Option is a configuration option that works in conjunction with [New]. For
// example:
//
//	timer := New(WithWidth(10, WithHeight(5)))
type Option func(*Model)

// WithWidth is an initialization option that sets the width of the
// viewport. Pass as an argument to [New].
func WithWidth(w int) Option {
	return func(m *Model) {
		m.width = w
	}
}

// WithHeight is an initialization option that sets the height of the
// viewport. Pass as an argument to [New].
func WithHeight(h int) Option {
	return func(m *Model) {
		m.height = h
	}
}

// WithScrollbar is an initialization option that enables or disables the scrollbar.
// Pass as an argument to [New].
func WithScrollbar(show bool) Option {
	return func(m *Model) {
		m.ShowScrollbar = show
	}
}

// WithScrollbarStyles is an initialization option that sets the scrollbar styles.
// Pass as an argument to [New].
func WithScrollbarStyles(track, thumb lipgloss.Style) Option {
	return func(m *Model) {
		m.ScrollbarStyle = track
		m.ScrollbarThumbStyle = thumb
	}
}

// New returns a new model with the given width and height as well as default
// key mappings.
func New(opts ...Option) (m Model) {
	m.setInitialValues()
	m.memo = &Memo{}

	// Initialize adaptive scroll state eagerly to prevent race conditions
	m.scrollState = &adaptiveScrollState{
		currentVelocity: baseVelocity,
		lastEventTime:   time.Now(),
	}

	// Initialize fixed-point precision fields
	m.yOffsetPrecise = 0
	m.scrollbarDragOffsetFixed = 0

	for _, opt := range opts {
		opt(&m)
	}
	return m
}

type Memo struct {
	dirty bool
	cache string
}

func (m *Memo) View(render func() string) string {
	if m.dirty {
		// slog.Debug("memo dirty")
		m.cache = render()
		m.dirty = false
		return m.cache
	}
	// slog.Debug("memo cache")
	return m.cache
}

func (m *Memo) Invalidate() {
	m.dirty = true
}

// Model is the Bubble Tea model for this viewport element.
type Model struct {
	memo   *Memo
	width  int
	height int
	KeyMap KeyMap

	// Whether or not to wrap text. If false, it'll allow horizontal scrolling
	// instead.
	SoftWrap bool

	// Whether or not to fill to the height of the viewport with empty lines.
	FillHeight bool

	// Whether or not to respond to the mouse. The mouse must be enabled in
	// Bubble Tea for this to work. For details, see the Bubble Tea docs.
	MouseWheelEnabled bool

	// The number of lines the mouse wheel will scroll. By default, this is 3.
	MouseWheelDelta int

	// Adaptive scroll configuration
	AdaptiveScrollEnabled bool
	AdaptiveConfig        *AdaptiveScrollConfig

	// YOffset is the vertical scroll position.
	YOffset int

	// xOffset is the horizontal scroll position.
	xOffset int

	// horizontalStep is the number of columns we move left or right during a
	// default horizontal scroll.
	horizontalStep int

	// YPosition is the position of the viewport in relation to the terminal
	// window. It's used in high performance rendering only.
	YPosition int

	// Style applies a lipgloss style to the viewport. Realistically, it's most
	// useful for setting borders, margins and padding.
	Style lipgloss.Style

	// LeftGutterFunc allows to define a [GutterFunc] that adds a column into
	// the left of the viewport, which is kept when horizontal scrolling.
	// This can be used for things like line numbers, selection indicators,
	// show statuses, etc.
	LeftGutterFunc GutterFunc

	initialized      bool
	lines            []string
	longestLineWidth int

	// HighlightStyle highlights the ranges set with [SetHighligths].
	HighlightStyle lipgloss.Style

	// SelectedHighlightStyle highlights the highlight range focused during
	// navigation.
	// Use [SetHighligths] to set the highlight ranges, and [HightlightNext]
	// and [HihglightPrevious] to navigate.
	SelectedHighlightStyle lipgloss.Style

	// StyleLineFunc allows to return a [lipgloss.Style] for each line.
	// The argument is the line index.
	StyleLineFunc func(int) lipgloss.Style

	highlights []highlightInfo
	hiIdx      int

	// Adaptive scroll state
	scrollState      *adaptiveScrollState
	scrollStateMutex sync.Mutex // Protects scrollState fields

	// Scrollbar settings
	ShowScrollbar       bool
	ScrollbarStyle      lipgloss.Style
	ScrollbarThumbStyle lipgloss.Style
	scrollbarDragging   bool
	scrollbarDragStartY int
	scrollbarDragOffset float64

	// Fixed-point precision fields to prevent drift
	scrollbarDragOffsetFixed int64 // in thousandths of a pixel
	yOffsetPrecise           int64 // precise offset in thousandths
}

// GutterFunc can be implemented and set into [Model.LeftGutterFunc].
//
// Example implementation showing line numbers:
//
//	func(info GutterContext) string {
//		if info.Soft {
//			return "     │ "
//		}
//		if info.Index >= info.TotalLines {
//			return "   ~ │ "
//		}
//		return fmt.Sprintf("%4d │ ", info.Index+1)
//	}
type GutterFunc func(GutterContext) string

// NoGutter is the default gutter used.
var NoGutter = func(GutterContext) string { return "" }

// GutterContext provides context to a [GutterFunc].
type GutterContext struct {
	Index      int
	TotalLines int
	Soft       bool
}

func (m *Model) setInitialValues() {
	m.KeyMap = DefaultKeyMap()
	m.MouseWheelEnabled = true
	m.MouseWheelDelta = defaultMouseWheelDelta
	m.initialized = true
	m.horizontalStep = defaultHorizontalStep
	m.LeftGutterFunc = NoGutter
	m.ShowScrollbar = true
	m.ScrollbarStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	m.ScrollbarThumbStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
}

// Init exists to satisfy the tea.Model interface for composability purposes.
func (m Model) Init() tea.Cmd {
	return nil
}

// Height returns the height of the viewport.
func (m Model) Height() int {
	return m.height
}

// SetHeight sets the height of the viewport.
func (m *Model) SetHeight(h int) {
	m.height = h
	m.memo.Invalidate()
}

// Width returns the width of the viewport.
func (m Model) Width() int {
	return m.width
}

// SetWidth sets the width of the viewport.
func (m *Model) SetWidth(w int) {
	m.width = w
	m.memo.Invalidate()
}

// AtTop returns whether or not the viewport is at the very top position.
func (m Model) AtTop() bool {
	return m.YOffset <= 0
}

// AtBottom returns whether or not the viewport is at or past the very bottom
// position.
func (m Model) AtBottom() bool {
	return m.YOffset >= m.maxYOffset()
}

// PastBottom returns whether or not the viewport is scrolled beyond the last
// line. This can happen when adjusting the viewport height.
func (m Model) PastBottom() bool {
	return m.YOffset > m.maxYOffset()
}

// IsDraggingScrollbar returns whether the scrollbar is currently being dragged
func (m Model) IsDraggingScrollbar() bool {
	return m.scrollbarDragging
}

// GetAdaptiveScrollState returns the current adaptive scroll state for preservation
func (m Model) GetAdaptiveScrollState() *adaptiveScrollState {
	return m.scrollState
}

// SetAdaptiveScrollState sets the adaptive scroll state (for preserving state across updates)
func (m *Model) SetAdaptiveScrollState(state *adaptiveScrollState) {
	m.scrollState = state
}

// ScrollPercent returns the amount scrolled as a float between 0 and 1.
func (m Model) ScrollPercent() float64 {
	if m.Height() >= m.lineCount() {
		return 1.0
	}
	// XXX: In the _vast_ majority of cases, this will not divide evenly. We
	// take advantage of the fact that int division rounds down to calculate
	// the percentage. See below.
	top := max(0, m.YOffset)
	bottom := max(0, m.maxYOffset())
	if bottom == 0 {
		return 0.0
	}
	return float64(top) / float64(bottom)
}

// HorizontalScrollPercent returns the amount horizontally scrolled as a float
// between 0 and 1.
func (m Model) HorizontalScrollPercent() float64 {
	if m.xOffset >= m.longestLineWidth-m.Width() {
		return 1.0
	}
	y := float64(m.xOffset)
	h := float64(m.Width())
	t := float64(m.longestLineWidth)
	v := y / (t - h)
	return math.Max(0.0, math.Min(1.0, v))
}

// SetContent set the pager's text content.
// Line endings will be normalized to '\n'.
func (m *Model) SetContent(s string) {
	s = strings.ReplaceAll(s, "\r\n", "\n") // normalize line endings
	m.SetContentLines(strings.Split(s, "\n"))
	m.memo.Invalidate()
}

// SetContentLines allows to set the lines to be shown instead of the content.
// If a given line has a \n in it, it'll be considered a [Model.SoftWrap].
// See also [Model.SetContent].
func (m *Model) SetContentLines(lines []string) {
	// if there's no content, set content to actual nil instead of one empty
	// line.
	m.lines = lines
	if len(m.lines) == 1 && ansi.StringWidth(m.lines[0]) == 0 {
		m.lines = nil
	}
	m.longestLineWidth = maxLineWidth(m.lines)
	m.ClearHighlights()

	if m.YOffset > m.maxYOffset() {
		m.GotoBottom()
	}
	m.memo.Invalidate()
}

// GetContent returns the entire content as a single string.
// Line endings are normalized to '\n'.
func (m Model) GetContent() string {
	return strings.Join(m.lines, "\n")
}

// calculateLine taking soft wrapping into account, returns the total viewable
// lines and the real-line index for the given yoffset.
func (m Model) calculateLine(yoffset int) (total, idx int) {
	if !m.SoftWrap {
		for i, line := range m.lines {
			adjust := max(1, lipgloss.Height(line))
			if yoffset >= total && yoffset < total+adjust {
				idx = i
			}
			total += adjust
		}
		if yoffset >= total {
			idx = len(m.lines)
		}
		return total, idx
	}

	maxWidth := m.maxWidth()
	var gutterSize int
	if m.LeftGutterFunc != nil {
		gutterSize = lipgloss.Width(m.LeftGutterFunc(GutterContext{}))
	}
	for i, line := range m.lines {
		adjust := max(1, lipgloss.Width(line)/(maxWidth-gutterSize))
		if yoffset >= total && yoffset < total+adjust {
			idx = i
		}
		total += adjust
	}
	if yoffset >= total {
		idx = len(m.lines)
	}
	return total, idx
}

// lineToIndex taking soft wrappign into account, return the real line index
// for the given line.
func (m Model) lineToIndex(y int) int {
	_, idx := m.calculateLine(y)
	return idx
}

// lineCount taking soft wrapping into account, return the total viewable line
// count (real lines + soft wrapped line).
func (m Model) lineCount() int {
	total, _ := m.calculateLine(0)
	return total
}

// maxYOffset returns the maximum possible value of the y-offset based on the
// viewport's content and set height.
func (m Model) maxYOffset() int {
	return max(0, m.lineCount()-m.Height()+m.Style.GetVerticalFrameSize())
}

// maxXOffset returns the maximum possible value of the x-offset based on the
// viewport's content and set width.
func (m Model) maxXOffset() int {
	width := m.Width()
	// Account for scrollbar if shown
	if m.ShowScrollbar && m.lineCount() > m.Height() {
		width--
	}
	return max(0, m.longestLineWidth-width)
}

func (m Model) maxWidth() int {
	var gutterSize int
	if m.LeftGutterFunc != nil {
		gutterSize = lipgloss.Width(m.LeftGutterFunc(GutterContext{}))
	}

	// Account for scrollbar width if it will be shown
	scrollbarWidth := 0
	if m.ShowScrollbar && m.lineCount() > m.Height() {
		scrollbarWidth = 1
	}

	return m.Width() -
		m.Style.GetHorizontalFrameSize() -
		gutterSize -
		scrollbarWidth
}

func (m Model) maxHeight() int {
	return m.Height() - m.Style.GetVerticalFrameSize()
}

// visibleLines returns the lines that should currently be visible in the
// viewport.
func (m Model) visibleLines() (lines []string) {
	maxHeight := m.maxHeight()
	maxWidth := m.maxWidth()

	if m.lineCount() > 0 {
		pos := m.lineToIndex(m.YOffset)
		top := max(0, pos)
		bottom := clamp(pos+maxHeight, top, len(m.lines))
		lines = make([]string, bottom-top)
		copy(lines, m.lines[top:bottom])
		lines = m.styleLines(lines, top)
		lines = m.highlightLines(lines, top)
	}

	for m.FillHeight && len(lines) < maxHeight {
		lines = append(lines, "")
	}

	// if longest line fit within width, no need to do anything else.
	if (m.xOffset == 0 && m.longestLineWidth <= maxWidth) || maxWidth == 0 {
		return m.setupGutter(lines)
	}

	if m.SoftWrap {
		return m.softWrap(lines, maxWidth)
	}

	for i, line := range lines {
		sublines := strings.Split(line, "\n") // will only have more than 1 if caller used [Model.SetContentLines].
		for j := range sublines {
			sublines[j] = ansi.Cut(sublines[j], m.xOffset, m.xOffset+maxWidth)
		}
		lines[i] = strings.Join(sublines, "\n")
	}
	return m.setupGutter(lines)
}

// styleLines styles the lines using [Model.StyleLineFunc].
func (m Model) styleLines(lines []string, offset int) []string {
	if m.StyleLineFunc == nil {
		return lines
	}
	for i := range lines {
		lines[i] = m.StyleLineFunc(i + offset).Render(lines[i])
	}
	return lines
}

// highlightLines highlights the lines with [Model.HighlightStyle] and
// [Model.SelectedHighlightStyle].
func (m Model) highlightLines(lines []string, offset int) []string {
	if len(m.highlights) == 0 {
		return lines
	}
	for i := range lines {
		ranges := makeHighlightRanges(
			m.highlights,
			i+offset,
			m.HighlightStyle,
		)
		lines[i] = lipgloss.StyleRanges(lines[i], ranges...)
		if m.hiIdx < 0 {
			continue
		}
		sel := m.highlights[m.hiIdx]
		if hi, ok := sel.lines[i+offset]; ok {
			lines[i] = lipgloss.StyleRanges(lines[i], lipgloss.NewRange(
				hi[0],
				hi[1],
				m.SelectedHighlightStyle,
			))
		}
	}
	return lines
}

func (m Model) softWrap(lines []string, maxWidth int) []string {
	var wrappedLines []string
	total := m.TotalLineCount()
	for i, line := range lines {
		idx := 0
		for ansi.StringWidth(line) >= idx {
			truncatedLine := ansi.Cut(line, idx, maxWidth+idx)
			if m.LeftGutterFunc != nil {
				truncatedLine = m.LeftGutterFunc(GutterContext{
					Index:      i + m.YOffset,
					TotalLines: total,
					Soft:       idx > 0,
				}) + truncatedLine
			}
			wrappedLines = append(wrappedLines, truncatedLine)
			idx += maxWidth
		}
	}
	return wrappedLines
}

// setupGutter sets up the left gutter using [Moddel.LeftGutterFunc].
func (m Model) setupGutter(lines []string) []string {
	if m.LeftGutterFunc == nil {
		return lines
	}

	offset := max(0, m.lineToIndex(m.YOffset))
	total := m.TotalLineCount()
	result := make([]string, len(lines))
	for i := range lines {
		var line []string
		for j, realLine := range strings.Split(lines[i], "\n") {
			line = append(line, m.LeftGutterFunc(GutterContext{
				Index:      i + offset,
				TotalLines: total,
				Soft:       j > 0,
			})+realLine)
		}
		result[i] = strings.Join(line, "\n")
	}
	m.memo.Invalidate()
	return result
}

// SetYOffset sets the Y offset.
func (m *Model) SetYOffset(n int) {
	m.YOffset = clamp(n, 0, m.maxYOffset())
	m.yOffsetPrecise = toFixed(float64(m.YOffset))
	m.memo.Invalidate()
}

// SetYOffsetPercent sets the Y offset based on a percentage (0.0 to 1.0)
func (m *Model) SetYOffsetPercent(percent float64) {
	percent = math.Max(0.0, math.Min(1.0, percent))
	maxOffset := m.maxYOffset()

	target := percent * float64(maxOffset)
	targetInt := int(target)

	m.SetYOffset(targetInt)

	m.yOffsetPrecise = toFixed(target)
}

// isOnScrollbar checks if the given coordinates are on the scrollbar
func (m Model) isOnScrollbar(x, y int) bool {
	if !m.ShowScrollbar {
		return false
	}
	// Scrollbar is on the right edge, but allow some tolerance for easier clicking
	return x >= m.Width()-scrollbarClickColumns && y < m.maxHeight()
}

// isOnScrollbarThumb checks if the given coordinates are on the scrollbar thumb
func (m Model) isOnScrollbarThumb(x, y int) bool {
	if !m.isOnScrollbar(x, y) {
		return false
	}

	thumbPos, thumbSize := m.scrollbarThumbPosition()
	return y >= thumbPos && y < thumbPos+thumbSize
}

// scrollbarThumbPosition returns the position and size of the scrollbar thumb
func (m Model) scrollbarThumbPosition() (pos, size int) {
	scrollbarHeight := m.maxHeight()
	if scrollbarHeight >= m.lineCount() {
		// Content fits entirely, thumb takes full height
		return 0, scrollbarHeight
	}

	viewportRatio := float64(scrollbarHeight) / float64(m.lineCount())

	// Calculate thumb size (minimum 1 character)
	thumbSize := int(math.Max(1, float64(scrollbarHeight)*viewportRatio))

	// Calculate thumb position using precise offset for accuracy
	availableSpace := scrollbarHeight - thumbSize
	maxOffset := m.maxYOffset()
	if maxOffset > 0 {
		scrollPercent := fromFixed(m.yOffsetPrecise) / float64(maxOffset)
		thumbPos := int(scrollPercent * float64(availableSpace))
		return thumbPos, thumbSize
	}

	return 0, thumbSize
}

// SetXOffset sets the X offset.
// No-op when soft wrap is enabled.
func (m *Model) SetXOffset(n int) {
	if m.SoftWrap {
		return
	}
	m.xOffset = clamp(n, 0, m.maxXOffset())
	m.memo.Invalidate()
}

// EnsureVisible ensures that the given line and column are in the viewport.
func (m *Model) EnsureVisible(line, colstart, colend int) {
	maxWidth := m.maxWidth()
	if colend <= maxWidth {
		m.SetXOffset(0)
	} else {
		m.SetXOffset(colstart - m.horizontalStep) // put one step to the left, feels more natural
	}

	if line < m.YOffset || line >= m.YOffset+m.maxHeight() {
		m.SetYOffset(line)
	}

	m.visibleLines()
}

// ViewDown moves the view down by the number of lines in the viewport.
// Basically, "page down".
func (m *Model) ViewDown() {
	if m.AtBottom() {
		return
	}

	m.LineDown(m.Height())
	m.memo.Invalidate()
}

// ViewUp moves the view up by one height of the viewport. Basically, "page up".
func (m *Model) ViewUp() {
	if m.AtTop() {
		return
	}

	m.LineUp(m.Height())
	m.memo.Invalidate()
}

// HalfViewDown moves the view down by half the height of the viewport.
func (m *Model) HalfViewDown() {
	if m.AtBottom() {
		return
	}

	m.LineDown(m.Height() / 2) //nolint:mnd
	m.memo.Invalidate()
}

// HalfViewUp moves the view up by half the height of the viewport.
func (m *Model) HalfViewUp() {
	if m.AtTop() {
		return
	}

	m.LineUp(m.Height() / 2) //nolint:mnd
	m.memo.Invalidate()
}

// LineDown moves the view down by the given number of lines.
func (m *Model) LineDown(n int) {
	if m.AtBottom() || n == 0 || len(m.lines) == 0 {
		return
	}

	// Make sure the number of lines by which we're going to scroll isn't
	// greater than the number of lines we actually have left before we reach
	// the bottom.
	m.SetYOffset(m.YOffset + n)
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
}

// LineUp moves the view down by the given number of lines. Returns the new
// lines to show.
func (m *Model) LineUp(n int) {
	if m.AtTop() || n == 0 || len(m.lines) == 0 {
		return
	}

	// Make sure the number of lines by which we're going to scroll isn't
	// greater than the number of lines we are from the top.
	m.SetYOffset(m.YOffset - n)
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
}

// TotalLineCount returns the total number of lines (both hidden and visible) within the viewport.
func (m Model) TotalLineCount() int {
	return m.lineCount()
}

// VisibleLineCount returns the number of the visible lines within the viewport.
func (m Model) VisibleLineCount() int {
	return len(m.visibleLines())
}

// GotoTop sets the viewport to the top position.
func (m *Model) GotoTop() (lines []string) {
	if m.AtTop() {
		return nil
	}

	m.SetYOffset(0)
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
	return m.visibleLines()
}

// GotoBottom sets the viewport to the bottom position.
func (m *Model) GotoBottom() (lines []string) {
	m.SetYOffset(m.maxYOffset())
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
	return m.visibleLines()
}

// SetHorizontalStep sets the amount of cells that the viewport moves in the
// default viewport keymapping. If set to 0 or less, horizontal scrolling is
// disabled.
func (m *Model) SetHorizontalStep(n int) {
	if n < 0 {
		n = 0
	}

	m.horizontalStep = n
	m.memo.Invalidate()
}

// MoveLeft moves the viewport to the left by the given number of columns.
func (m *Model) MoveLeft(cols int) {
	m.xOffset -= cols
	if m.xOffset < 0 {
		m.xOffset = 0
		m.memo.Invalidate()
	}
}

// MoveRight moves viewport to the right by the given number of columns.
func (m *Model) MoveRight(cols int) {
	// prevents over scrolling to the right
	w := m.maxWidth()
	if m.xOffset > m.longestLineWidth-w {
		return
	}
	m.xOffset += cols
}

// Resets lines indent to zero.
func (m *Model) ResetIndent() {
	m.xOffset = 0
	m.memo.Invalidate()
}

// SetHighlights sets ranges of characters to highlight.
// For instance, `[]int{[]int{2, 10}, []int{20, 30}}` will highlight characters
// 2 to 10 and 20 to 30.
// Note that highlights are not expected to transpose each other, and are also
// expected to be in order.
// Use [Model.SetHighlights] to set the highlight ranges, and
// [Model.HighlightNext] and [Model.HighlightPrevious] to navigate.
// Use [Model.ClearHighlights] to remove all highlights.
func (m *Model) SetHighlights(matches [][]int) {
	if len(matches) == 0 || len(m.lines) == 0 {
		return
	}
	m.highlights = parseMatches(m.GetContent(), matches)
	m.hiIdx = m.findNearedtMatch()
	m.showHighlight()
	m.memo.Invalidate()
}

// ClearHighlights clears previously set highlights.
func (m *Model) ClearHighlights() {
	m.highlights = nil
	m.hiIdx = -1
	m.memo.Invalidate()
}

func (m *Model) showHighlight() {
	if m.hiIdx == -1 {
		return
	}
	line, colstart, colend := m.highlights[m.hiIdx].coords()
	m.EnsureVisible(line, colstart, colend)
	m.memo.Invalidate()
}

// HighlightNext highlights the next match.
func (m *Model) HighlightNext() {
	if m.highlights == nil {
		return
	}

	m.hiIdx = (m.hiIdx + 1) % len(m.highlights)
	m.showHighlight()
	m.memo.Invalidate()
}

// HighlightPrevious highlights the previous match.
func (m *Model) HighlightPrevious() {
	if m.highlights == nil {
		return
	}

	m.hiIdx = (m.hiIdx - 1 + len(m.highlights)) % len(m.highlights)
	m.showHighlight()
	m.memo.Invalidate()
}

func (m Model) findNearedtMatch() int {
	for i, match := range m.highlights {
		if match.lineStart >= m.YOffset {
			return i
		}
	}
	return -1
}

// Update handles standard message-based viewport updates.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	m = m.updateAsModel(msg)
	return m, nil
}

// Author's note: this method has been broken out to make it easier to
// potentially transition Update to satisfy tea.Model.
func (m Model) updateAsModel(msg tea.Msg) Model {
	if !m.initialized {
		m.setInitialValues()
	}

	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		switch {
		case key.Matches(msg, m.KeyMap.PageDown):
			m.ViewDown()

		case key.Matches(msg, m.KeyMap.PageUp):
			m.ViewUp()

		case key.Matches(msg, m.KeyMap.HalfPageDown):
			m.HalfViewDown()

		case key.Matches(msg, m.KeyMap.HalfPageUp):
			m.HalfViewUp()

		case key.Matches(msg, m.KeyMap.Down):
			m.LineDown(1)

		case key.Matches(msg, m.KeyMap.Up):
			m.LineUp(1)

		case key.Matches(msg, m.KeyMap.Left):
			m.MoveLeft(m.horizontalStep)

		case key.Matches(msg, m.KeyMap.Right):
			m.MoveRight(m.horizontalStep)
		}

	case tea.MouseClickMsg:
		if m.ShowScrollbar && m.isOnScrollbar(msg.X, msg.Y) {
			thumbPos, thumbSize := m.scrollbarThumbPosition()
			onThumb := m.isOnScrollbarThumb(msg.X, msg.Y)

			if !onThumb {
				scrollbarHeight := m.maxHeight()
				availableSpace := scrollbarHeight - thumbSize
				maxOffset := m.maxYOffset()
				if availableSpace > 0 && maxOffset > 0 {
					targetThumbPos := max(0, min(msg.Y+1, availableSpace))
					scrollPercent := float64(targetThumbPos) / float64(availableSpace)
					targetYOffsetFloat := scrollPercent * float64(maxOffset)
					targetYOffset := int(targetYOffsetFloat)
					m.YOffset = clamp(targetYOffset, 0, maxOffset)
					m.yOffsetPrecise = toFixed(targetYOffsetFloat)
					m.memo.Invalidate()
				}

				m.scrollbarDragging = true
				m.scrollbarDragStartY = msg.Y
				m.scrollbarDragOffset = 1
				m.scrollbarDragOffsetFixed = toFixed(1.0)
			} else {
				m.scrollbarDragging = true
				m.scrollbarDragStartY = msg.Y
				m.scrollbarDragOffset = float64(msg.Y - thumbPos)
				m.scrollbarDragOffsetFixed = toFixed(float64(msg.Y - thumbPos))
			}
		}

	case tea.MouseMotionMsg:
		if m.scrollbarDragging {
			_, thumbSize := m.scrollbarThumbPosition()

			targetThumbTopFixed := toFixed(float64(msg.Y)) - m.scrollbarDragOffsetFixed
			maxThumbPosFixed := toFixed(float64(m.Height() - thumbSize))

			if maxThumbPosFixed > 0 {
				scrollPercent := fromFixed(targetThumbTopFixed) / fromFixed(maxThumbPosFixed)
				m.SetYOffsetPercent(scrollPercent)
			}
		}

	case tea.MouseReleaseMsg:
		m.scrollbarDragging = false

	case tea.MouseWheelMsg:
		if !m.MouseWheelEnabled || m.scrollbarDragging {
			break
		}

		delta := m.MouseWheelDelta

		if m.AdaptiveScrollEnabled && m.AdaptiveConfig != nil {
			m.updateAdaptiveScrollTiming()
			delta = m.calculateAdaptiveDelta(delta)
		}

		switch msg.Button {
		case tea.MouseWheelDown:
			m.LineDown(delta)

		case tea.MouseWheelUp:
			m.LineUp(delta)
		}
	}

	return m
}

// updateAdaptiveScrollTiming updates the timing for adaptive scroll velocity calculation
// This should be called immediately when a scroll event is received, before any processing
func (m *Model) updateAdaptiveScrollTiming() {
	m.updateAdaptiveScrollTimingWithEvent(true)
}

// updateAdaptiveScrollTimingWithEvent updates velocity, optionally marking a new scroll event
func (m *Model) updateAdaptiveScrollTimingWithEvent(isScrollEvent bool) {
	// scrollState is now initialized in New(), no need for nil check
	m.scrollStateMutex.Lock()
	defer m.scrollStateMutex.Unlock()

	now := time.Now()
	elapsed := now.Sub(m.scrollState.lastEventTime).Milliseconds()

	// Smooth velocity curve using continuous function instead of hard boundaries
	velocityTarget := baseVelocity

	if elapsed < m.AdaptiveConfig.TimeWindow {
		// Acceleration phase - smooth ramp up based on how recent
		progress := float64(m.AdaptiveConfig.TimeWindow-elapsed) / float64(m.AdaptiveConfig.TimeWindow)
		// Use smoothstep for smoother acceleration
		progress = progress * progress * (smoothstepFactor1 - smoothstepFactor2*progress)
		velocityTarget = m.scrollState.currentVelocity + m.AdaptiveConfig.Acceleration*progress
		velocityTarget = math.Min(velocityTarget, m.AdaptiveConfig.MaxMultiplier)
	} else {
		// Deceleration phase - smooth exponential decay
		decayTime := float64(elapsed - m.AdaptiveConfig.TimeWindow)
		// Use exponential decay that reaches near-zero in reasonable time
		// Decay rate adjusted to reach ~0.1 of original after 1 second
		decayFactor := math.Exp(-decayTime / (float64(m.AdaptiveConfig.TimeWindow) * decayTimeMultiplier))
		velocityTarget = baseVelocity + (m.scrollState.currentVelocity-baseVelocity)*decayFactor*m.AdaptiveConfig.Deceleration
	}

	// Smooth transition to target velocity (prevents jumps)
	m.scrollState.currentVelocity = m.scrollState.currentVelocity*velocitySmoothingFactor +
		velocityTarget*(1-velocitySmoothingFactor)

	// Snap to base velocity when very close to prevent lingering momentum
	const velocityThreshold = 0.05
	if math.Abs(m.scrollState.currentVelocity-baseVelocity) < velocityThreshold {
		m.scrollState.currentVelocity = baseVelocity
	}

	// Ensure bounds
	m.scrollState.currentVelocity = math.Max(baseVelocity,
		math.Min(m.AdaptiveConfig.MaxMultiplier, m.scrollState.currentVelocity))

	// Only update lastEventTime if this is an actual scroll event
	if isScrollEvent {
		m.scrollState.lastEventTime = now
	}
}

// ensureScrollState is a defensive helper to ensure scrollState is initialized
// This should not be needed if New() is always used, but provides safety
func (m *Model) ensureScrollState() {
	m.scrollStateMutex.Lock()
	defer m.scrollStateMutex.Unlock()

	if m.scrollState == nil {
		m.scrollState = &adaptiveScrollState{
			currentVelocity: baseVelocity,
			lastEventTime:   time.Now(),
		}
	}
}

// calculateAdaptiveDelta calculates the scroll delta based on current velocity
// This uses the velocity that was already calculated by updateAdaptiveScrollTiming
func (m *Model) calculateAdaptiveDelta(base int) int {
	// scrollState is now initialized in New(), no need for nil check
	// But we can call ensureScrollState() for extra safety if needed
	m.scrollStateMutex.Lock()
	velocity := m.scrollState.currentVelocity
	m.scrollStateMutex.Unlock()

	result := int(float64(base) * velocity)
	return result
}

// View renders the viewport into a string.
func (m Model) View() string {
	return m.memo.View(func() string {
		w, h := m.Width(), m.Height()
		if sw := m.Style.GetWidth(); sw != 0 {
			w = min(w, sw)
		}
		if sh := m.Style.GetHeight(); sh != 0 {
			h = min(h, sh)
		}

		// Check if scrollbar will be shown
		showScrollbar := m.ShowScrollbar && m.lineCount() > m.Height()

		// Get visible lines (already accounts for scrollbar in maxWidth)
		visible := m.visibleLines()

		// Calculate dimensions
		contentHeight := h - m.Style.GetVerticalFrameSize()
		contentWidth := w - m.Style.GetHorizontalFrameSize()

		// Don't reduce width here since visibleLines already did
		var contents string
		if showScrollbar {
			// Render content at the width calculated by visibleLines
			// and let addScrollbar handle combining with scrollbar
			contents = strings.Join(visible, "\n")
			contents = m.addScrollbar(contents, contentHeight)
		} else {
			// No scrollbar, render normally
			contents = lipgloss.NewStyle().
				Width(contentWidth).
				Height(contentHeight).
				MaxHeight(contentHeight).
				MaxWidth(contentWidth).
				Render(strings.Join(visible, "\n"))
		}

		return m.Style.
			UnsetWidth().UnsetHeight().
			Render(contents)
	})
}

// addScrollbar adds a scrollbar to the right side of the content
func (m Model) addScrollbar(content string, height int) string {
	// Safety check for invalid height
	if height <= 0 {
		return content
	}

	lines := strings.Split(content, "\n")

	// Ensure we have the right number of lines
	for len(lines) < height {
		lines = append(lines, "")
	}

	// Get scrollbar thumb position and size
	thumbPos, thumbSize := m.scrollbarThumbPosition()

	// Calculate the actual content width (accounting for frame and scrollbar)
	contentWidth := m.Width() - m.Style.GetHorizontalFrameSize() - 1
	if contentWidth <= 0 {
		return content
	}

	// Pre-allocate buffer with estimated size
	// Estimate: average line length * height + scrollbar chars + newlines
	estimatedSize := len(content) + height*2
	var result bytes.Buffer
	result.Grow(estimatedSize)

	// Pre-allocate padding buffer once
	maxPadding := contentWidth
	paddingBuf := make([]byte, maxPadding)
	for i := range paddingBuf {
		paddingBuf[i] = ' '
	}

	// Pre-render scrollbar characters once
	thumbChar := m.ScrollbarThumbStyle.Render("█")
	trackChar := m.ScrollbarStyle.Render("│")

	for i := 0; i < height && i < len(lines); i++ {
		if i > 0 {
			result.WriteByte('\n')
		}

		line := lines[i]

		// Ensure line is exactly the right width for consistent alignment
		lineWidth := ansi.StringWidth(line)
		if lineWidth > contentWidth {
			// Truncate if too long
			line = ansi.Cut(line, 0, contentWidth)
			result.WriteString(line)
		} else if lineWidth < contentWidth {
			// Write line then padding
			result.WriteString(line)
			paddingNeeded := contentWidth - lineWidth
			result.Write(paddingBuf[:paddingNeeded])
		} else {
			result.WriteString(line)
		}

		// Add scrollbar character
		if i >= thumbPos && i < thumbPos+thumbSize {
			result.WriteString(thumbChar)
		} else {
			result.WriteString(trackChar)
		}
	}

	return result.String()
}

func clamp(v, low, high int) int {
	if high < low {
		low, high = high, low
	}
	return min(high, max(low, v))
}

func maxLineWidth(lines []string) int {
	result := 0
	for _, line := range lines {
		result = max(result, lipgloss.Width(line))
	}
	return result
}
