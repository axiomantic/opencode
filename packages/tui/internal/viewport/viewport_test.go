package viewport

import (
	"sync"
	"testing"
	"time"
)

func TestViewport_AdaptiveScrollCalculation(t *testing.T) {
	tests := []struct {
		name              string
		config            *AdaptiveScrollConfig
		timeBetweenEvents []int64 // milliseconds between events
		expectedDeltas    []int
		baseScrollSpeed   int
	}{
		{
			name: "rapid scrolling increases velocity",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			timeBetweenEvents: []int64{10, 10, 10, 10}, // Fast scrolling
			expectedDeltas:    []int{3, 3, 4, 4},       // Gradual increase with smoothing
			baseScrollSpeed:   3,
		},
		{
			name: "slow scrolling maintains base speed",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			timeBetweenEvents: []int64{100, 100, 100}, // Slow scrolling
			expectedDeltas:    []int{3, 3, 3},         // Base speed maintained
			baseScrollSpeed:   3,
		},
		{
			name: "velocity decays after fast scrolling",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			timeBetweenEvents: []int64{10, 10, 200}, // Fast then slow
			expectedDeltas:    []int{3, 3, 3},       // Smoothed velocity changes
			baseScrollSpeed:   3,
		},
		{
			name: "respects max multiplier",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 3.0,
				Acceleration:  1.0, // Fast acceleration
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			timeBetweenEvents: []int64{10, 10, 10, 10, 10}, // Very fast scrolling
			expectedDeltas:    []int{3, 4, 5, 6, 7},        // Gradual increase with smoothing, working toward max
			baseScrollSpeed:   3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New()
			m.AdaptiveScrollEnabled = true
			m.AdaptiveConfig = tt.config
			m.MouseWheelDelta = tt.baseScrollSpeed

			for i, delay := range tt.timeBetweenEvents {
				// Simulate time passing
				if i > 0 {
					m.scrollStateMutex.Lock()
					m.scrollState.lastEventTime = time.Now().Add(-time.Duration(delay) * time.Millisecond)
					m.scrollStateMutex.Unlock()
				}

				// Update velocity based on timing
				m.updateAdaptiveScrollTiming()

				delta := m.calculateAdaptiveDelta(tt.baseScrollSpeed)

				// Allow for small rounding differences
				if delta < tt.expectedDeltas[i]-1 || delta > tt.expectedDeltas[i]+1 {
					t.Errorf("Event %d: expected delta ~%d, got %d", i, tt.expectedDeltas[i], delta)
				}
			}
		})
	}
}

func TestViewport_AdaptiveScroll_Disabled(t *testing.T) {
	m := New()
	m.AdaptiveScrollEnabled = false
	m.MouseWheelDelta = 3

	// Should return base delta when disabled
	delta := m.MouseWheelDelta
	if delta != 3 {
		t.Errorf("Expected delta 3 when adaptive scroll disabled, got %d", delta)
	}
}

func TestViewport_AdaptiveScroll_StateInitialization(t *testing.T) {
	m := New()
	m.AdaptiveScrollEnabled = true
	m.AdaptiveConfig = &AdaptiveScrollConfig{
		MaxMultiplier: 5.0,
		Acceleration:  0.5,
		Deceleration:  0.95,
		TimeWindow:    50,
	}
	m.MouseWheelDelta = 3

	// State should already be initialized by New()
	if m.scrollState == nil {
		t.Fatal("Expected scroll state to be initialized by New()")
	}

	m.scrollStateMutex.Lock()
	velocity := m.scrollState.currentVelocity
	m.scrollStateMutex.Unlock()

	if velocity != 1.0 {
		t.Errorf("Expected initial velocity 1.0, got %f", velocity)
	}

	// First call should use initial velocity
	delta := m.calculateAdaptiveDelta(3)
	if delta != 3 {
		t.Errorf("Expected initial delta 3, got %d", delta)
	}
}

func BenchmarkAdaptiveScrollCalculation(b *testing.B) {
	m := New()
	m.AdaptiveScrollEnabled = true
	m.AdaptiveConfig = &AdaptiveScrollConfig{
		MaxMultiplier: 5.0,
		Acceleration:  0.5,
		Deceleration:  0.95,
		TimeWindow:    50,
	}
	m.MouseWheelDelta = 3

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.calculateAdaptiveDelta(3)
	}
}

// TestAdaptiveScrollConcurrentAccess tests that concurrent access to scroll state
// doesn't cause race conditions or panics
func TestAdaptiveScrollConcurrentAccess(t *testing.T) {
	m := New(WithWidth(80), WithHeight(24))
	m.AdaptiveScrollEnabled = true
	m.AdaptiveConfig = &AdaptiveScrollConfig{
		MaxMultiplier: 5.0,
		Acceleration:  0.5,
		Deceleration:  0.95,
		TimeWindow:    50,
	}

	var wg sync.WaitGroup
	errors := make(chan error, 100)

	// Spawn multiple goroutines to stress test
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					errors <- r.(error)
				}
			}()
			m.updateAdaptiveScrollTiming()
		}()
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					errors <- r.(error)
				}
			}()
			_ = m.calculateAdaptiveDelta(3)
		}()
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		if err != nil {
			t.Errorf("Concurrent access error: %v", err)
		}
	}
}
