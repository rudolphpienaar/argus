#!/bin/bash

SOURCE_DIR="src/argus/data/_source"
DATA_DIR="src/argus/data"
PROVIDERS=("BCH" "MGH" "BIDMC" "BWH" "NIH")
URL_FILE="$SOURCE_DIR/image_urls.txt"

echo "Downloading source images..."
# Download images from the URL list
count=0
while read -r url; do
    filename=$(basename "$url")
    # Only download if not already present
    if [ ! -f "$SOURCE_DIR/$filename" ]; then
        if curl -s -f -L "$url" -o "$SOURCE_DIR/$filename"; then
            echo -n "."
            ((count++))
        else
            echo "x" # Indicate failure but continue
        fi
    else
        ((count++))
    fi
done < "$URL_FILE"
echo ""
echo "Total source images available: $count"

# Get list of source images (files only)
# Use nullglob to handle empty case safely
shopt -s nullglob
SOURCE_IMAGES=("$SOURCE_DIR"/*.{jpg,png,jpeg})
shopt -u nullglob

NUM_SOURCE=${#SOURCE_IMAGES[@]}

if [ $NUM_SOURCE -eq 0 ]; then
    echo "No source images found! Please check network or URL list."
    exit 1
fi

echo "Populating provider directories..."

for provider in "${PROVIDERS[@]}"; do
    PROVIDER_DIR="$DATA_DIR/$provider"
    mkdir -p "$PROVIDER_DIR"
    
    # Clean existing
    rm -f "$PROVIDER_DIR"/*
    
    # Generate random number of files (between 150 and 300)
    NUM_FILES=$((150 + RANDOM % 150))
    echo "Generating $NUM_FILES files for $provider..."
    
    for ((i=1; i<=NUM_FILES; i++)); do
        # Pick random source image
        RAND_IDX=$((RANDOM % NUM_SOURCE))
        SRC_IMG="${SOURCE_IMAGES[$RAND_IDX]}"
        EXT="${SRC_IMG##*.}"
        
        # Format: PROVIDER_001.ext
        DEST_NAME=$(printf "%s_%03d.%s" "$provider" "$i" "$EXT")
        
        # Copy file
        cp "$SRC_IMG" "$PROVIDER_DIR/$DEST_NAME"
    done
    
    # Generate auxiliary files based on provider type
    case "$provider" in
        "BCH" | "MGH" | "NIH")
            echo "Generating labels.csv for $provider..."
            echo "filename,label,confidence" > "$PROVIDER_DIR/labels.csv"
            for file in "$PROVIDER_DIR"/*.{jpg,png,jpeg}; do
                fname=$(basename "$file")
                # Random labels
                if (( RANDOM % 2 == 0 )); then label="NORMAL"; else label="PNEUMONIA"; fi
                conf="0.$(( 80 + RANDOM % 20 ))"
                echo "$fname,$label,$conf" >> "$PROVIDER_DIR/labels.csv"
            done
            ;;
            
        "BWH")
            echo "Generating segmentation masks for $provider..."
            mkdir -p "$PROVIDER_DIR/masks"
            MASK_SRC="src/argus/data/_source/mask_placeholder.png"
            if [ -f "$MASK_SRC" ]; then
                for file in "$PROVIDER_DIR"/*.{jpg,png,jpeg}; do
                    fname=$(basename "$file")
                    # Replace extension with _mask.png
                    maskname="${fname%.*}_mask.png"
                    cp "$MASK_SRC" "$PROVIDER_DIR/masks/$maskname"
                done
            else
                echo "Warning: mask_placeholder.png not found"
            fi
            ;;
            
        "BIDMC")
            echo "Generating annotations.json for $provider..."
            echo "[" > "$PROVIDER_DIR/annotations.json"
            first=true
            for file in "$PROVIDER_DIR"/*.{jpg,png,jpeg}; do
                fname=$(basename "$file")
                if [ "$first" = true ]; then first=false; else echo "," >> "$PROVIDER_DIR/annotations.json"; fi
                
                # Mock bounding box
                x=$(( RANDOM % 500 ))
                y=$(( RANDOM % 500 ))
                w=$(( 100 + RANDOM % 200 ))
                h=$(( 100 + RANDOM % 200 ))
                
                echo "  { \"file\": \"$fname\", \"box\": [$x, $y, $w, $h], \"label\": \"opacity\" }" >> "$PROVIDER_DIR/annotations.json"
            done
            echo "]" >> "$PROVIDER_DIR/annotations.json"
            ;;
    esac
done

echo "Done! Federated data simulated."
