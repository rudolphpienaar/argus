# Chell Makefile
#
# Build and manage the Chell Interactive Shell

CUMIN_DIR := ../cumin
SALSA_DIR := ../salsa
CHILI_DIR := ../chili
CHELL_DIR := .

# Repository URLs
CUMIN_REPO := https://github.com/FNNDSC/cumin.git
SALSA_REPO := https://github.com/FNNDSC/salsa.git
CHILI_REPO := https://github.com/FNNDSC/chili.git

.PHONY: help shop prep cook taste taste-flight serve scrub taco install build test clean link all

help:
	@echo "Chell Makefile 🐚"
	@echo ""
	@echo "Commands:"
	@echo "  make shop    - Clone 'cumin', 'salsa', and 'chili' repositories"
	@echo "  make prep    - Install dependencies"
	@echo "  make cook    - Build dependencies (cumin, salsa, chili) and chell"
	@echo "  make taste   - Run tests"
	@echo "  make taste-flight - Run tests with coverage (v8 provider)"
	@echo "  make serve   - Link globally"
	@echo "  make scrub   - Clean artifacts"
	@echo "  make taco    - Full build (scrub, shop, prep, cook)"

# --- Shop (Cloning) ---

shop: shop-cumin shop-salsa shop-chili

shop-cumin:
	@if [ ! -d "$(CUMIN_DIR)" ]; then \
		echo "🛒 Shopping for cumin..."; \
		git clone $(CUMIN_REPO) $(CUMIN_DIR); \
	else \
		echo "🔄 Updating cumin..."; \
		(cd $(CUMIN_DIR) && git pull) || echo "⚠️ Failed to update cumin. Please resolve manually."; \
	fi

shop-salsa:
	@if [ ! -d "$(SALSA_DIR)" ]; then \
		echo "🛒 Shopping for salsa..."; \
		git clone $(SALSA_REPO) $(SALSA_DIR); \
	else \
		echo "🔄 Updating salsa..."; \
		(cd $(SALSA_DIR) && git pull) || echo "⚠️ Failed to update salsa. Please resolve manually."; \
	fi

shop-chili:
	@if [ ! -d "$(CHILI_DIR)" ]; then \
		echo "🛒 Shopping for chili..."; \
		git clone $(CHILI_REPO) $(CHILI_DIR); \
	else \
		echo "🔄 Updating chili..."; \
		(cd $(CHILI_DIR) && git pull) || echo "⚠️ Failed to update chili. Please resolve manually."; \
	fi

prep:
	@echo "🔪 Prepping chell (installing deps)..."
	cd $(CHELL_DIR) && npm install

cook:
	@echo "🍳 Cooking dependencies..."
	cd $(CUMIN_DIR) && npm install && npm run build
	cd $(SALSA_DIR) && npm install && npm run build
	cd $(CHILI_DIR) && npm install && npm run build
	@echo "🍳 Cooking chell..."
	cd $(CHELL_DIR) && npm run build

taste:
	@echo "👅 Tasting chell..."
	cd $(CHELL_DIR) && npm test

# Coverage (not part of taco)
taste-flight:
	@echo "👅 Tasting flight (with coverage) chell..."
	cd $(CHELL_DIR) && npm test -- --coverage --coverageProvider=v8

serve:
	@echo "🍽️ Serving chell..."
	cd $(CHELL_DIR) && npm link

scrub:
	@echo "🧽 Scrubbing chell..."
	cd $(CHELL_DIR) && rm -rf dist node_modules package-lock.json

taco: scrub shop prep cook taste serve

install: prep
build: cook
test: taste
clean: scrub
link: serve
all: taco
