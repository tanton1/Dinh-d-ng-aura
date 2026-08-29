import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const COLORS = ['#f43f8c', '#fb7185', '#fb923c', '#fbbf24']

interface Props {
  revenueData: Array<{ name: string; total: number }>
  packageData: Array<{ name: string; value: number }>
}

function money(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

export default function AdminReportCharts({ revenueData, packageData }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 lg:col-span-2">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-white">Dòng tiền theo ngày hạch toán</h2>
            <p className="mt-1 text-xs text-zinc-500">Không dùng ngày bắt đầu hợp đồng. P&amp;L xem tại Tài chính.</p>
          </div>
          <span className="rounded-full bg-pink-500/10 px-3 py-1 text-xs font-bold text-pink-400">Canonical</span>
        </div>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
              <defs><linearGradient id="reportRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f43f8c" stopOpacity={0.4} /><stop offset="95%" stopColor="#fb923c" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value) / 1_000_000}M`} />
              <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: 12 }} formatter={(value) => money(Number(value) || 0)} />
              <Area type="monotone" dataKey="total" stroke="#f43f8c" strokeWidth={3} fill="url(#reportRevenue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="font-bold text-white">Hợp đồng đang hoạt động</h2>
        <p className="mt-1 text-xs text-zinc-500">Phân bố theo gói, không phải doanh thu.</p>
        <div className="mt-4 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={packageData} innerRadius={55} outerRadius={78} dataKey="value" paddingAngle={4}>{packageData.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: 12 }} /></PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">{packageData.slice(0, 5).map((item, index) => <div key={item.name} className="flex items-center justify-between text-xs"><span className="flex min-w-0 items-center gap-2 text-zinc-400"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /> <span className="truncate">{item.name}</span></span><b className="text-white">{item.value}</b></div>)}</div>
      </section>
    </div>
  )
}
