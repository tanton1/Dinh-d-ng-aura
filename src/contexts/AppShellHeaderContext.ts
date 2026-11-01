import { createContext } from 'react'

// Pages can place their own mobile action in the shell without duplicating
// handlers or moving page data loading into the global navigation.
export const AppShellHeaderContext = createContext<HTMLElement | null>(null)
