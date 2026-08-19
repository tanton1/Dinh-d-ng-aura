import React, { useState, useRef } from 'react';
import { Utensils, ImagePlus, X, Bot, Loader2, Send } from 'lucide-react';
import Markdown from 'react-markdown';
import { Student } from '../../../types';

interface Props {
  student: Student;
}

export default function MealAnalysis({ student }: Props) {
  const [mealDescription, setMealDescription] = useState('');
  const [currentGoal, setCurrentGoal] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAnalyze = async () => {
    if (!mealDescription && !image) {
      setError('Vui lòng nhập mô tả bữa ăn hoặc tải lên hình ảnh.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const response = await fetch('/api/analyze-meal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mealDescription,
          imageUrl: image,
          currentGoal: currentGoal || student.nutritionNote || 'Giảm mỡ, tăng cơ',
          studentInfo: `Tên: ${student.name}, SĐT: ${student.phone || ''}`
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error('Dữ liệu trả về không hợp lệ (Có thể ảnh quá lớn, vượt quá giới hạn 50MB)');
      }

      if (!response.ok) {
        throw new Error(data.details || data.error || 'Có lỗi xảy ra khi phân tích');
      }

      setAnalysisResult(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="bg-zinc-900 p-5 lg:p-8 rounded-2xl border border-zinc-800 shadow-sm relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute -top-20 -right-20 w-64 h-64 bg-pink-500/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="flex items-center gap-3 mb-6 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500/20 to-rose-500/20 flex items-center justify-center border border-pink-500/30 shrink-0">
          <Bot className="w-5 h-5 text-pink-500" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">AI Phân Tích Bữa Ăn</h3>
          <p className="text-sm text-zinc-400">Đánh giá và đề xuất dinh dưỡng chuẩn xác bằng AI</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 relative z-10">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Mục tiêu hiện tại của học viên</label>
            <input
              type="text"
              value={currentGoal}
              onChange={(e) => setCurrentGoal(e.target.value)}
              placeholder={student.nutritionNote || "VD: Giảm 2kg trong 1 tháng, tăng cơ..."}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-pink-500 outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Mô tả bữa ăn (Nguyên liệu, cách nấu)</label>
            <textarea
              value={mealDescription}
              onChange={(e) => setMealDescription(e.target.value)}
              placeholder="VD: 1 bát phở bò tái nạm, không lấy nước béo, nhiều hành..."
              rows={4}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:border-pink-500 outline-none transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Hình ảnh bữa ăn (Tuỳ chọn)</label>
            {!image ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-32 border-2 border-dashed border-zinc-800 rounded-xl hover:border-pink-500/50 hover:bg-zinc-800/50 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 group"
              >
                <div className="w-10 h-10 rounded-full bg-zinc-950 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <ImagePlus className="w-4 h-4 text-zinc-400 group-hover:text-pink-500 transition-colors" />
                </div>
                <span className="text-xs text-zinc-500">Tải ảnh lên hoặc chụp ảnh</span>
              </div>
            ) : (
              <div className="relative w-full h-48 rounded-xl overflow-hidden border border-zinc-700 bg-zinc-950 flex items-center justify-center group">
                <img src={image} alt="Meal preview" className="max-h-full object-contain" />
                <button
                  onClick={removeImage}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black text-white flex items-center justify-center backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm flex items-start gap-2">
              <span className="shrink-0">⚠️</span>
              <p>{error}</p>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="w-full py-3.5 bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold rounded-xl hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-pink-500/20"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Đang phân tích...
              </>
            ) : (
              <>
                <Utensils className="w-5 h-5" />
                Phân tích & Đánh giá
              </>
            )}
          </button>
        </div>

        {/* Results */}
        <div className="h-full relative">
          <div className="absolute inset-0 bg-zinc-950 border border-zinc-800 rounded-xl p-6 overflow-y-auto custom-scrollbar">
            {!analysisResult && !isAnalyzing ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 opacity-60">
                <Bot className="w-16 h-16 text-zinc-700 mb-4" />
                <p className="text-sm font-medium">Kết quả phân tích AI sẽ hiển thị tại đây</p>
                <p className="text-xs mt-1 text-center max-w-[250px]">Bao gồm ước tính Calo, đánh giá độ phù hợp và các đề xuất chuyên môn.</p>
              </div>
            ) : isAnalyzing ? (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 text-pink-500 flex items-center justify-center animate-pulse">
                    <Bot className="w-8 h-8" />
                  </div>
                  <svg className="animate-spin w-full h-full text-pink-500/30" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <p className="text-sm font-medium text-pink-500 mt-4 animate-pulse">AI đang xử lý thông tin...</p>
              </div>
            ) : analysisResult ? (
              <div className="markdown-body prose prose-invert prose-pink max-w-none text-sm">
                <Markdown>{analysisResult}</Markdown>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
