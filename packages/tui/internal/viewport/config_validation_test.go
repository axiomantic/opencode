package viewport

import (
	"testing"
)

func TestAdaptiveScrollConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		config  *AdaptiveScrollConfig
		wantErr bool
	}{
		{
			name: "valid config",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			wantErr: false,
		},
		{
			name:    "nil config is valid",
			config:  nil,
			wantErr: false,
		},
		{
			name: "MaxMultiplier too low",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 0.5,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			wantErr: true,
		},
		{
			name: "MaxMultiplier too high",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 25.0,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			wantErr: true,
		},
		{
			name: "Acceleration negative",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  -0.1,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			wantErr: true,
		},
		{
			name: "Acceleration too high",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  2.5,
				Deceleration:  0.95,
				TimeWindow:    50,
			},
			wantErr: true,
		},
		{
			name: "Deceleration negative",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  -0.1,
				TimeWindow:    50,
			},
			wantErr: true,
		},
		{
			name: "Deceleration too high",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  1.5,
				TimeWindow:    50,
			},
			wantErr: true,
		},
		{
			name: "TimeWindow too low",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    5,
			},
			wantErr: true,
		},
		{
			name: "TimeWindow too high",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 5.0,
				Acceleration:  0.5,
				Deceleration:  0.95,
				TimeWindow:    600,
			},
			wantErr: true,
		},
		{
			name: "minimal valid config",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 1.0,
				Acceleration:  0,
				Deceleration:  0,
				TimeWindow:    10,
			},
			wantErr: false,
		},
		{
			name: "maximal valid config",
			config: &AdaptiveScrollConfig{
				MaxMultiplier: 20.0,
				Acceleration:  2.0,
				Deceleration:  1.0,
				TimeWindow:    500,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.config.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
