import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add 'overdue' to state
content = content.replace(
  "const [activeFilter, setActiveFilter] = useState<'all' | 'priority' | 'new' | 'low_ai' | 'pending_response' | 'approved'>('all')",
  "const [activeFilter, setActiveFilter] = useState<'all' | 'priority' | 'new' | 'low_ai' | 'pending_response' | 'approved' | 'overdue'>('all')\n  const [now, setNow] = useState(Date.now())\n  useEffect(() => {\n    const timer = setInterval(() => setNow(Date.now()), 60000)\n    return () => clearInterval(timer)\n  }, [])\n  const [hasSwitchedToOverdue, setHasSwitchedToOverdue] = useState(false)\n  useEffect(() => {\n    const hasOverdue = allMeals.some(m => m.status === 'pending' && m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000)\n    if (hasOverdue && !hasSwitchedToOverdue) {\n      setActiveFilter('overdue')\n      setHasSwitchedToOverdue(true)\n    }\n  }, [allMeals, now, hasSwitchedToOverdue])"
);

// 2. Add filter logic for overdue
content = content.replace(
  "if (activeFilter === 'approved') return m.status === 'approved'",
  "if (activeFilter === 'approved') return m.status === 'approved'\n      if (activeFilter === 'overdue') return m.status === 'pending' && Boolean(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000)"
);

// 3. Compute onTimePercentage
content = content.replace(
  "// Batch Selection State",
  "const onTimePercentage = useMemo(() => {\n    const approved = allMeals.filter(m => m.status === 'approved')\n    if (approved.length === 0) return 100\n    const onTimeCount = approved.filter(m => {\n      if (!m.createdAtTimestamp || !m.approvedAtTimestamp) return true\n      return (m.approvedAtTimestamp - m.createdAtTimestamp) <= 3600000\n    }).length\n    return Math.round((onTimeCount / approved.length) * 100)\n  }, [allMeals])\n\n  // Batch Selection State"
);

// 4. Overdue Meals group
content = content.replace(
  "const pendingMeals = useMemo(() => {",
  "const overdueMeals = useMemo(() => {\n    return filteredMeals.filter((m) => m.status === 'pending' && Boolean(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000))\n  }, [filteredMeals, now])\n\n  const pendingMeals = useMemo(() => {"
);

// Exclude overdue from pending and highPriority? "Trễ SLA" is a higher priority. Let's exclude overdue from pending and priority so they don't duplicate.
content = content.replace(
  "return filteredMeals.filter((m) => m.priority === 'high' && m.status === 'pending')",
  "return filteredMeals.filter((m) => m.priority === 'high' && m.status === 'pending' && !(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000))"
);
content = content.replace(
  "return filteredMeals.filter((m) => m.priority !== 'high' && m.status === 'pending')",
  "return filteredMeals.filter((m) => m.priority !== 'high' && m.status === 'pending' && !(m.createdAtTimestamp && (now - m.createdAtTimestamp) > 3600000))"
);

fs.writeFileSync(file, content);
