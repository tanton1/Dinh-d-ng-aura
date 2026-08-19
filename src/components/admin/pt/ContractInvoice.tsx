import React from 'react';
import { Student, StudentContract } from '../../../types';
import { Printer, X } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  student: Student;
  contract: StudentContract;
  onClose: () => void;
}

export default function ContractInvoice({ student, contract, onClose }: Props) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm print:bg-white print:p-0">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto print:shadow-none print:w-full print:max-w-none print:max-h-none print:overflow-visible"
      >
        {/* Print Actions - Hidden when printing */}
        <div className="sticky top-0 z-10 bg-zinc-100 p-3 flex justify-between items-center border-b border-zinc-200 print:hidden">
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-800 font-medium px-3 py-1 flex items-center gap-1">
            <X className="w-4 h-4" /> Đóng
          </button>
          <button onClick={handlePrint} className="bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-emerald-600 flex items-center gap-2">
            <Printer className="w-4 h-4" /> In Hợp đồng
          </button>
        </div>

        {/* Printable Content */}
        <div className="p-8 text-black print:p-0">
          <div className="text-center mb-8 border-b-2 border-black pb-6">
            <h1 className="text-3xl font-black tracking-tighter uppercase">Aura Fitness</h1>
            <p className="text-sm text-gray-600 mt-1">Sức khỏe của bạn, Đam mê của chúng tôi</p>
            <h2 className="text-2xl font-bold mt-6 uppercase">Hợp đồng Huấn luyện cá nhân</h2>
            <p className="text-sm font-mono mt-1">Mã HĐ: HD-{contract.id.slice(-6)}</p>
            <p className="text-sm">Ngày ký: {new Date(contract.startDate).toLocaleDateString('vi-VN')}</p>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold border-b border-gray-300 pb-2 mb-3">Bên A: Trung tâm</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="font-medium">Đại diện:</span> Ban Quản lý</p>
              <p><span className="font-medium">Điện thoại:</span> 1900 1234</p>
              <p className="col-span-2"><span className="font-medium">Địa chỉ:</span> 123 Đường Sức Khỏe, Quận 1, TP.HCM</p>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold border-b border-gray-300 pb-2 mb-3">Bên B: Khách hàng (Học viên)</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="font-medium">Họ và tên:</span> {student.name}</p>
              <p><span className="font-medium">Điện thoại:</span> {student.phone || '---'}</p>
              <p className="col-span-2"><span className="font-medium">Email:</span> {student.email || '---'}</p>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold border-b border-gray-300 pb-2 mb-3">Điều khoản dịch vụ</h3>
            <table className="w-full text-left border-collapse mb-4">
              <thead>
                <tr className="bg-gray-100">
                  <th className="p-3 font-bold text-sm border border-gray-300">Tên gói tập</th>
                  <th className="p-3 font-bold text-sm border border-gray-300 text-center">Số buổi</th>
                  <th className="p-3 font-bold text-sm border border-gray-300 text-right">Tổng tiền</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-3 border border-gray-300">{contract.packageName}</td>
                  <td className="p-3 border border-gray-300 text-center">{contract.totalSessions}</td>
                  <td className="p-3 border border-gray-300 text-right font-medium">{contract.totalPrice.toLocaleString('vi-VN')}đ</td>
                </tr>
              </tbody>
            </table>
            
            <div className="flex justify-end mb-6">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tổng giá trị HĐ:</span>
                  <span className="font-bold">{contract.totalPrice.toLocaleString('vi-VN')}đ</span>
                </div>
                {contract.discount && contract.discount > 0 && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>Giảm giá:</span>
                    <span>-{contract.discount.toLocaleString('vi-VN')}đ</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-emerald-600">
                  <span>Đã thanh toán:</span>
                  <span>{contract.paidAmount.toLocaleString('vi-VN')}đ</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t-2 border-black pt-2 mt-2">
                  <span>Còn nợ:</span>
                  <span className="text-red-600">{(contract.totalPrice - (contract.discount || 0) - contract.paidAmount).toLocaleString('vi-VN')}đ</span>
                </div>
              </div>
            </div>

            <div className="text-sm text-gray-700 space-y-2 leading-relaxed">
              <p>1. Thời hạn hợp đồng: Từ ngày <span className="font-bold">{new Date(contract.startDate).toLocaleDateString('vi-VN')}</span> đến ngày <span className="font-bold">{new Date(contract.endDate).toLocaleDateString('vi-VN')}</span>.</p>
              <p>2. Bên B cam kết thanh toán đầy đủ số tiền còn nợ (nếu có) theo đúng thỏa thuận với Bên A.</p>
              <p>3. Hợp đồng không có giá trị quy đổi thành tiền mặt hoặc chuyển nhượng cho người khác nếu không có sự đồng ý của Bên A.</p>
              <p>4. Bên A cam kết cung cấp dịch vụ huấn luyện theo đúng tiêu chuẩn và lộ trình đã tư vấn cho Bên B.</p>
            </div>
          </div>
          
          <div className="mt-12 flex justify-between px-8 pb-12">
            <div className="text-center">
              <p className="font-bold mb-16">Bên B (Khách hàng)</p>
              <p className="text-gray-400">(Ký & ghi rõ họ tên)</p>
            </div>
            <div className="text-center">
              <p className="font-bold mb-16">Bên A (Đại diện)</p>
              <p className="text-gray-400">(Ký & ghi rõ họ tên)</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
