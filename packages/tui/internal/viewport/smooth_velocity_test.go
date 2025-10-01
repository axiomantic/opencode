package viewport

import (
	"strings"
	"testing"
	"time"
)

func TestSmoothVelocityTransitions(t *testing.T) {
	v := New(WithWidth(80), WithHeight(10))
	v.AdaptiveScrollEnabled = true
	v.AdaptiveConfig = &AdaptiveScrollConfig{
		MaxMultiplier: 5.0,
		Acceleration:  0.5,
		Deceleration:  0.95,
		TimeWindow:    50,
	}

	// Generate test content
	content := strings.Repeat("Line content\n", 100)
	v.SetContent(content)

	// Simulate rapid scrolling to build up velocity
	for i := 0; i < 10; i++ {
		v.LineDown(1)
		v.updateAdaptiveScrollTiming()
		time.Sleep(10 * time.Millisecond)
	}

	v.scrollStateMutex.Lock()
	initialVelocity := v.scrollState.currentVelocity
	v.scrollStateMutex.Unlock()

	t.Logf("Initial velocity after scrolling: %f", initialVelocity)

	// Simulate no scrolling - velocity should decay smoothly
	var velocities []float64
	velocities = append(velocities, initialVelocity)

	for i := 0; i < 20; i++ {
		time.Sleep(50 * time.Millisecond)
		// Update velocity without marking as a new scroll event
		v.updateAdaptiveScrollTimingWithEvent(false)

		v.scrollStateMutex.Lock()
		currentVelocity := v.scrollState.currentVelocity
		v.scrollStateMutex.Unlock()

		velocities = append(velocities, currentVelocity)
		t.Logf("Velocity at step %d (after %dms): %f", i+1, (i+1)*50, currentVelocity)
	}

	// Check that velocity is always decreasing (monotonic decay)
	hasIncreased := false
	for i := 1; i < len(velocities); i++ {
		if velocities[i] > velocities[i-1] {
			t.Errorf("Velocity increased at step %d: %f -> %f",
				i, velocities[i-1], velocities[i])
			hasIncreased = true
		}
	}

	// Check that the decay is smooth (no huge jumps)
	// Skip the first few steps as they may have larger changes when transitioning from acceleration
	for i := 4; i < len(velocities); i++ {
		prevDelta := velocities[i-2] - velocities[i-1]
		currDelta := velocities[i-1] - velocities[i]

		// Current delta shouldn't be more than 5x the previous (allows for initial transition)
		if prevDelta > 0.001 && currDelta > prevDelta*5 {
			t.Errorf("Decay rate changed too abruptly at step %d: prev_delta=%f, curr_delta=%f",
				i, prevDelta, currDelta)
		}
	}

	// Velocity should eventually reach near base (1.0)
	v.scrollStateMutex.Lock()
	finalVelocity := v.scrollState.currentVelocity
	v.scrollStateMutex.Unlock()

	// After 1 second, velocity should be close to base
	if finalVelocity > 1.1 {
		t.Errorf("Velocity didn't decay to near base (1.0) after 1 second: %f", finalVelocity)
	}

	if !hasIncreased && finalVelocity <= 1.1 {
		t.Logf("SUCCESS: Velocity decayed smoothly from %f to %f", initialVelocity, finalVelocity)
	}
}

func TestSmoothAccelerationCurve(t *testing.T) {
	v := New(WithWidth(80), WithHeight(10))
	v.AdaptiveScrollEnabled = true
	v.AdaptiveConfig = &AdaptiveScrollConfig{
		MaxMultiplier: 5.0,
		Acceleration:  0.5,
		Deceleration:  0.95,
		TimeWindow:    50,
	}

	// Generate test content
	content := strings.Repeat("Line content\n", 100)
	v.SetContent(content)

	// Build up speed gradually
	var velocities []float64
	for i := 0; i < 15; i++ {
		v.LineDown(1)
		v.updateAdaptiveScrollTiming()

		v.scrollStateMutex.Lock()
		velocities = append(velocities, v.scrollState.currentVelocity)
		v.scrollStateMutex.Unlock()

		time.Sleep(20 * time.Millisecond)
	}

	// Check that acceleration is smooth (using smoothstep)
	for i := 1; i < len(velocities); i++ {
		if velocities[i] < velocities[i-1] {
			// Velocity should only increase during acceleration phase
			t.Errorf("Velocity decreased during acceleration at step %d: %f -> %f",
				i, velocities[i-1], velocities[i])
		}

		// Check that the acceleration rate decreases (S-curve)
		if i > 1 {
			accel1 := velocities[i-1] - velocities[i-2]
			accel2 := velocities[i] - velocities[i-1]

			// In the middle of the curve, acceleration should start decreasing
			if i > len(velocities)/2 && accel2 > accel1*1.5 {
				t.Errorf("Acceleration not following S-curve at step %d", i)
			}
		}
	}
}

func TestNoVelocityJumpsOnTimeoutReset(t *testing.T) {
	v := New(WithWidth(80), WithHeight(10))
	v.AdaptiveScrollEnabled = true
	v.AdaptiveConfig = &AdaptiveScrollConfig{
		MaxMultiplier: 5.0,
		Acceleration:  0.5,
		Deceleration:  0.95,
		TimeWindow:    50,
	}

	// Generate test content
	content := strings.Repeat("Line content\n", 100)
	v.SetContent(content)

	// Build up velocity
	for i := 0; i < 5; i++ {
		v.LineDown(1)
		v.updateAdaptiveScrollTiming()
		time.Sleep(10 * time.Millisecond)
	}

	v.scrollStateMutex.Lock()
	velocityBeforePause := v.scrollState.currentVelocity
	v.scrollStateMutex.Unlock()

	// Simulate long pause (beyond TimeWindow*4)
	time.Sleep(time.Duration(v.AdaptiveConfig.TimeWindow*5) * time.Millisecond)
	// Update velocity without marking as a new scroll event
	v.updateAdaptiveScrollTimingWithEvent(false)

	v.scrollStateMutex.Lock()
	velocityAfterPause := v.scrollState.currentVelocity
	v.scrollStateMutex.Unlock()

	// Velocity should decay smoothly, not reset to zero abruptly
	if velocityBeforePause > 0.5 && velocityAfterPause == 0 {
		t.Errorf("Velocity reset too abruptly: %f -> %f",
			velocityBeforePause, velocityAfterPause)
	}
}
