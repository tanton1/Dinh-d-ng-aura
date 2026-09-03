import React, { useState, useEffect, useMemo } from 'react';
import { TrainingPackage, Quote, Student, StudentContract, Branch, UserProfile } from '../../../types';
import { User } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebaseFirestore';
import { FileText, Printer, Plus, Trash2, Download, Package, Edit2, Clock, Hash, DollarSign, ShoppingCart, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PackageSettings from './PackageSettings';
import DateRangeFilter from './DateRangeFilter';
import { useDatabase } from '../../../contexts/DatabaseContext';

interface Props {
  user?: User | null;
  profile?: UserProfile | null;
  onNavigate?: (screen: string) => void;
}

export default function QuoteGenerator({ user, profile, onNavigate }: Props) {
  const isTrainer = profile?.role === 'trainer';
  const { students, contracts, packages, branches, addStudent, addContract } = useDatabase();
  const [activeSubTab, setActiveSubTab] = useState<'quotes' | 'packages'>('quotes');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [dateRange, setDateRange] = useState<{ start: Date, end: Date } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);

  const filteredQuotes = useMemo(() => {
    let filtered = quotes;
    if (dateRange) {
      filtered = filtered.filter(q => {
        const qDate = new Date(q.date);
        return qDate >= dateRange.start && qDate <= dateRange.end;
      });
    }
    return filtered;
  }, [quotes, dateRange]);

  // Form State
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [discount, setDiscount] = useState('');
  const [referralCode, setReferralCode] = useState('');

  useEffect(() => {
    if (user && db) {
      const fetchData = async () => {
        if (!db) return;
        const docRef = doc(db, 'schedules', 'global_schedule');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setQuotes(data.quotes || []);
        }
      };
      fetchData();
    }
  }, [user]);

  const handleGenerateQuote = async () => {
    const pkg = packages.find(p => p.id === selectedPackageId);
    if (!pkg || !customerName) return;

    const discountAmount = Number(discount) || 0;
    const finalPrice = Math.max(0, pkg.price - discountAmount);
    
    // Generate a unique code: BG-YYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const randomStr = Math.floor(1000 + Math.random() * 9000).toString();
    const code = `BG-${dateStr}-${randomStr}`;

    const newQuote: Quote = {
      id: Date.now().toString(),
      code,
      customerName,
      customerPhone,
      branchId: selectedBranchId,
      packageId: pkg.id,
      packageName: pkg.name,
      originalPrice: pkg.price,
      discount: discountAmount,
      finalPrice,
      date: new Date().toISOString(),
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Valid for 7 days
      status: 'pending',
      referralCode: referralCode || undefined
    };

    const newQuotes = [newQuote, ...quotes];
    setQuotes(newQuotes);
    
    if (user && db) {
      try {
        await setDoc(doc(db, 'schedules', 'global_schedule'), { quotes: newQuotes }, { merge: true });
      } catch (e) {
        console.error("Error saving quote:", e);
        alert("Có lỗi khi lưu báo giá!");
      }
    }

    setIsCreating(false);
    setSelectedQuote(newQuote);
    
    // Reset form
    setCustomerName('');
    setCustomerPhone('');
    setSelectedPackageId('');
    setSelectedBranchId('');
    setDiscount('');
    setReferralCode('');
  };

  const handleDeleteQuote = async (id: string) => {
    if (confirm('Xóa báo giá này?')) {
      const newQuotes = quotes.filter(q => q.id !== id);
      setQuotes(newQuotes);
      if (user && db) {
        await setDoc(doc(db, 'schedules', 'global_schedule'), { quotes: newQuotes }, { merge: true });
      }
    }
  };

  const handleAcceptQuote = async (quote: Quote) => {
    if (!confirm('Chốt báo giá này và tạo/cập nhật hồ sơ học viên?')) return;

    const pkg = packages.find(p => p.id === quote.packageId);
    if (!pkg) {
      alert('Không tìm thấy gói tập tương ứng!');
      return;
    }

    const sanitizePhone = (phone: string) => {
      let p = phone.replace(/\D/g, '');
      if (p.startsWith('84')) {
        p = '0' + p.slice(2);
      }
      return p;
    };
    const sanitizedQuotePhone = quote.customerPhone ? sanitizePhone(quote.customerPhone) : '';
    
    // Find existing student by phone or name
    let existingStudent = students.find(s => 
      (s.phone && quote.customerPhone && sanitizePhone(s.phone) === sanitizedQuotePhone) ||
      (s.name.toLowerCase().trim() === quote.customerName.toLowerCase().trim())
    );

    let studentIdToUse = '';
    let isNewStudent = false;
    let newStudent: Student | null = null;

    const getLocalDateStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (existingStudent) {
      if (!confirm(`Tìm thấy học viên "${existingStudent.name}" đã tồn tại trong hệ thống. Bạn có muốn thêm gói tập này cho học viên hiện tại không? (Chọn Cancel để hủy)`)) {
        return;
      }
      studentIdToUse = existingStudent.id;
    } else {
      isNewStudent = true;
      studentIdToUse = Date.now().toString();
      newStudent = {
        id: studentIdToUse,
        name: quote.customerName,
        phone: quote.customerPhone,
        email: quote.customerPhone ? `${quote.customerPhone}@aurafitness.com` : '',
        sessionsPerWeek: 3,
        availableSlots: [],
        status: 'active',
        joinDate: getLocalDateStr(new Date()),
        branchId: quote.branchId,
      };
    }

    // 1. Update quote status
    const newQuotes = quotes.map(q => q.id === quote.id ? { ...q, status: 'accepted' as const } : q);

    // 3. Create Contract
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + pkg.durationMonths);

    const newContract: StudentContract = {
      id: Date.now().toString() + '-c',
      studentId: studentIdToUse,
      branchId: quote.branchId || existingStudent?.branchId || '',
      packageId: pkg.id,
      packageName: pkg.name,
      startDate: getLocalDateStr(startDate),
      endDate: getLocalDateStr(endDate),
      totalSessions: pkg.totalSessions,
      usedSessions: 0,
      totalPrice: quote.finalPrice,
      paidAmount: 0,
      status: 'active',
      installments: quote.finalPrice > 0 ? [{
        id: Date.now().toString() + '-inst-0',
        amount: quote.finalPrice,
        date: getLocalDateStr(startDate),
        status: 'pending'
      }] : [],
      nextPaymentDate: quote.finalPrice > 0 ? getLocalDateStr(startDate) : null,
      referralCode: quote.referralCode || null,
      referralCommission: null // Calculate dynamically when paid based on paidAmount
    };

    // Re-fetch current state to be safe after potential awaits (though none here yet, good practice)
    setQuotes(newQuotes);

    if (user && db) {
      try {
        await setDoc(doc(db, 'schedules', 'global_schedule'), { 
          quotes: JSON.parse(JSON.stringify(newQuotes)),
        }, { merge: true });
        
        if (isNewStudent && newStudent) {
          await addStudent(newStudent);
        }
        await addContract(newContract);
        
        alert('Đã chốt sale thành công! Hợp đồng đã được tạo.');
      } catch (e) {
        console.error("Error accepting quote:", e);
        alert("Có lỗi khi chốt báo giá!");
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Sales Sub-tabs */}
      <div className="flex p-1 bg-zinc-900 rounded-xl border border-zinc-800">
        <button
          onClick={() => setActiveSubTab('quotes')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeSubTab === 'quotes' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <FileText className="w-4 h-4" />
          Báo giá
        </button>
        <button
          onClick={() => setActiveSubTab('packages')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeSubTab === 'packages' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Package className="w-4 h-4" />
          Thiết lập Gói
        </button>
      </div>

      {activeSubTab === 'packages' ? (
        <PackageSettings user={user ?? null} profile={profile ?? null} />
      ) : (
        <>
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-pink-500" />
              Bán Hàng
            </h2>
            <div className="flex gap-2">
              <DateRangeFilter onFilter={(start, end) => setDateRange({ start, end })} />
              <button 
                onClick={() => setIsCreating(true)}
                className="bg-pink-500 text-white px-4 py-2 rounded-xl font-medium hover:bg-pink-600 transition-colors flex items-center gap-2 shadow-[0_0_15px_rgba(255,0,127,0.3)]"
              >
                <Plus className="w-4 h-4" /> Tạo báo giá
              </button>
            </div>
          </div>

          {/* Quote List */}
          <div className="space-y-3">
            {filteredQuotes.length > 0 ? filteredQuotes.map(quote => (
              <div key={quote.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex justify-between items-center shadow-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-1 rounded">{quote.code}</span>
                    <span className="text-xs text-zinc-500">{new Date(quote.date).toLocaleDateString('vi-VN')}</span>
                    {quote.status === 'accepted' ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Đã chốt
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Chờ chốt
                      </span>
                    )}
                  </div>
                  <h4 className="text-white font-medium">{quote.customerName}</h4>
                  <p className="text-sm text-zinc-400">
                    {quote.packageName} - <span className="text-pink-500 font-bold">{quote.finalPrice.toLocaleString('vi-VN')}đ</span>
                    {quote.referralCode && <span className="ml-2 text-xs text-amber-500">Mã GT: {quote.referralCode}</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  {quote.status !== 'accepted' && (
                    <button 
                      onClick={() => handleAcceptQuote(quote)}
                      title="Chốt sale & Tạo học viên"
                      className="p-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-xl transition-colors"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={() => setSelectedQuote(quote)}
                    title="Xem chi tiết"
                    className="p-2 bg-zinc-800 text-zinc-300 hover:text-white rounded-xl transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                  {!isTrainer && (
                    <button 
                      onClick={() => handleDeleteQuote(quote.id)}
                      title="Xóa báo giá"
                      className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-xl transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )) : (
              <div className="text-center py-10 text-zinc-500 bg-zinc-900 rounded-2xl border border-zinc-800">
                Chưa có báo giá nào được tạo.
              </div>
            )}
          </div>
        </>
      )}

      {/* Create Quote Modal */}
      <AnimatePresence>
        {isCreating && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsCreating(false)}
            />
            <motion.div 
              role="dialog"
              aria-modal="true"
              aria-label="Tạo báo giá mới"
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800"
            >
              <h3 className="text-xl font-bold text-white mb-6">Tạo Báo giá mới</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Tên khách hàng *</label>
                  <input 
                    type="text" 
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: Nguyễn Văn A"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Số điện thoại</label>
                  <input 
                    type="tel" 
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: 0987654321"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Cơ sở (Không bắt buộc)</label>
                  <select 
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="">-- Tất cả cơ sở --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Chọn gói tập *</label>
                  <select 
                    value={selectedPackageId}
                    onChange={e => setSelectedPackageId(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="">-- Chọn gói --</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.price.toLocaleString('vi-VN')}đ)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Giảm giá (VNĐ)</label>
                  <input 
                    type="number" 
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: 500000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Mã giới thiệu (Mã nhân viên PT)</label>
                  <input 
                    type="text" 
                    value={referralCode}
                    onChange={e => setReferralCode(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500 uppercase" 
                    placeholder="VD: PT001"
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    onClick={() => setIsCreating(false)}
                    className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handleGenerateQuote}
                    disabled={!customerName || !selectedPackageId}
                    className="flex-1 py-3 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_15px_rgba(255,0,127,0.4)]"
                  >
                    Tạo báo giá
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Quote Modal (Printable) */}
      <AnimatePresence>
        {selectedQuote && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm print:bg-white print:p-0">
            <motion.div 
              role="dialog"
              aria-modal="true"
              aria-label={`Báo giá của ${selectedQuote.customerName}`}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden print:shadow-none print:w-full print:max-w-none"
            >
              {/* Print Actions - Hidden when printing */}
              <div className="bg-zinc-100 p-3 flex justify-between items-center border-b border-zinc-200 print:hidden">
                <button onClick={() => setSelectedQuote(null)} className="text-zinc-500 hover:text-zinc-800 font-medium px-3 py-1">Đóng</button>
                <div className="flex gap-2">
                  {selectedQuote.status !== 'accepted' && (
                    <button 
                      onClick={() => {
                        handleAcceptQuote(selectedQuote);
                        setSelectedQuote(null);
                      }} 
                      className="bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-emerald-600 flex items-center gap-2"
                    >
                      <CheckCircle className="w-4 h-4" /> Chốt Sale
                    </button>
                  )}
                  <button onClick={handlePrint} className="bg-pink-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-pink-600 flex items-center gap-2">
                    <Printer className="w-4 h-4" /> In báo giá
                  </button>
                </div>
              </div>

              {/* Printable Content */}
              <div className="p-8 text-black print:p-0">
                <div className="flex justify-between items-start mb-8 border-b-2 border-black pb-6">
                  <div>
                    <h1 className="text-3xl font-black tracking-tighter uppercase"></h1>
                    <p className="text-sm text-gray-600 mt-1">Sức khỏe của bạn, Đam mê của chúng tôi</p>
                  </div>
                  <div className="text-right">
                    <h2 className="text-2xl font-bold text-pink-600 uppercase">BÁO GIÁ</h2>
                    <p className="text-sm font-mono mt-1">Mã: {selectedQuote.code}</p>
                    <p className="text-sm">Ngày: {new Date(selectedQuote.date).toLocaleDateString('vi-VN')}</p>
                  </div>
                </div>

                <div className="mb-8">
                  <h3 className="text-lg font-bold border-b border-gray-300 pb-2 mb-3">Thông tin khách hàng</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Họ và tên</p>
                      <p className="font-medium">{selectedQuote.customerName}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Số điện thoại</p>
                      <p className="font-medium">{selectedQuote.customerPhone || '---'}</p>
                    </div>
                  </div>
                  {selectedQuote.referralCode && (
                    <div className="mt-4">
                      <p className="text-sm text-gray-500">Mã giới thiệu (PT hỗ trợ)</p>
                      <p className="font-medium">{selectedQuote.referralCode}</p>
                    </div>
                  )}
                </div>

                <div className="mb-8">
                  <h3 className="text-lg font-bold border-b border-gray-300 pb-2 mb-3">Chi tiết dịch vụ</h3>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="p-3 font-bold text-sm border border-gray-300">Tên gói tập</th>
                        <th className="p-3 font-bold text-sm border border-gray-300 text-right">Đơn giá</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="p-3 border border-gray-300">{selectedQuote.packageName}</td>
                        <td className="p-3 border border-gray-300 text-right font-medium">{selectedQuote.originalPrice.toLocaleString('vi-VN')}đ</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end mb-8">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Tổng cộng:</span>
                      <span>{selectedQuote.originalPrice.toLocaleString('vi-VN')}đ</span>
                    </div>
                    <div className="flex justify-between text-sm text-red-500">
                      <span>Giảm giá:</span>
                      <span>- {selectedQuote.discount.toLocaleString('vi-VN')}đ</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold border-t-2 border-black pt-2 mt-2">
                      <span>Thành tiền:</span>
                      <span className="text-pink-600">{selectedQuote.finalPrice.toLocaleString('vi-VN')}đ</span>
                    </div>
                  </div>
                </div>

                <div className="text-sm text-gray-500 mt-12 pt-4 border-t border-gray-200">
                  <p>* Báo giá này có giá trị đến ngày: <span className="font-medium text-black">{new Date(selectedQuote.validUntil).toLocaleDateString('vi-VN')}</span></p>
                  <p>* Giá trên đã bao gồm VAT và các dịch vụ đi kèm theo tiêu chuẩn của phòng tập.</p>
                </div>
                
                <div className="mt-16 flex justify-between px-8">
                  <div className="text-center">
                    <p className="font-bold mb-16">Khách hàng</p>
                    <p className="text-gray-400">(Ký & ghi rõ họ tên)</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold mb-16">Đại diện</p>
                    <p className="text-gray-400">(Ký & ghi rõ họ tên)</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
