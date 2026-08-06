import fs from 'fs';
const file = 'src/pages/student/CapturedMealDetail.tsx';
let content = fs.readFileSync(file, 'utf8');

const target = `        {/* Ingredients / Thành Phần Section */}
        <div className="fdet-section">
          <div className="fdet-section-header">
            <h2 className="fdet-section-title">Thành phần</h2>
            <button
              type="button"
              className="fdet-add-more-btn"
              onClick={() => setShowAddIngredientModal(true)}
            >
              <Plus size={15} />
              <span>Thêm</span>
            </button>
          </div>

          <div className="fdet-ingredients-list">
            {ingredients.map((item) => {
              const scaledGrams = Math.round(item.grams * portionCount)
              const scaledCalories = Math.round(item.calories * portionCount)

              return (
                <div className="fdet-ingredient-card" key={item.id}>
                  <div className="fdet-ing-left">
                    <strong className="fdet-ing-name">{item.name}</strong>
                    <span className="fdet-ing-cal"> · {scaledCalories} cal</span>
                  </div>

                  <div className="fdet-ing-right">
                    <span className="fdet-ing-grams">{scaledGrams}g</span>
                    {ingredients.length > 1 && (
                      <button
                        type="button"
                        className="fdet-ing-del"
                        onClick={() => handleDeleteIngredient(item.id)}
                        title="Xóa thành phần"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>`;

const replacement = `        {/* Ingredients / Thành Phần Section */}
        {ingredients.length > 0 && (
          <div className="fdet-section">
            <div className="fdet-section-header">
              <h2 className="fdet-section-title">Thành phần</h2>
              <button
                type="button"
                className="fdet-add-more-btn"
                onClick={() => setShowAddIngredientModal(true)}
              >
                <Plus size={15} />
                <span>Thêm</span>
              </button>
            </div>

            <div className="fdet-ingredients-list">
              {ingredients.map((item) => {
                const scaledGrams = Math.round(item.grams * portionCount)
                const scaledCalories = Math.round(item.calories * portionCount)

                return (
                  <div className="fdet-ingredient-card" key={item.id}>
                    <div className="fdet-ing-left">
                      <strong className="fdet-ing-name">{item.name}</strong>
                      <span className="fdet-ing-cal"> · {scaledCalories} cal</span>
                    </div>

                    <div className="fdet-ing-right">
                      <span className="fdet-ing-grams">{scaledGrams}g</span>
                      {ingredients.length > 1 && (
                        <button
                          type="button"
                          className="fdet-ing-del"
                          onClick={() => handleDeleteIngredient(item.id)}
                          title="Xóa thành phần"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}`;

content = content.replace(target, replacement);
fs.writeFileSync(file, content);
