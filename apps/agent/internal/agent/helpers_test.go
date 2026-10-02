package agent

import "github.com/jabedzaman/meshguard/internal/state"

func stateLoad(a *Agent) (*state.State, error)  { return state.Load(a.StateDir) }
func stateSave(a *Agent, st *state.State) error { return state.Save(a.StateDir, st) }
