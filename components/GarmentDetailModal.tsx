/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WardrobeItem } from '../types';
import { XIcon, PaletteIcon, CheckCircleIcon } from './icons';
import { getHarmonicColors, recolorGarment } from '../services/geminiService';
import Spinner from './Spinner';

const urlToFile = (url: string, filename: string): Promise<File> => {
    // If the URL is a blob URL, we can fetch it directly.
    if (url.startsWith('blob:')) {
        return fetch(url)
            .then(res => res.blob())
            .then(blob => new File([blob], filename, { type: blob.type }));
    }
    // For other URLs, use the canvas method to handle potential CORS issues.
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.setAttribute('crossOrigin', 'anonymous');
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Could not get canvas context.'));
            ctx.drawImage(image, 0, 0);
            canvas.toBlob((blob) => {
                if (!blob) return reject(new Error('Canvas toBlob failed.'));
                resolve(new File([blob], filename, { type: blob.type || 'image/png' }));
            }, 'image/png');
        };
        image.onerror = (error) => reject(new Error(`Could not load image. Error: ${error}`));
        image.src = url;
    });
};

type Variation = {
    hex: string;
    url: string;
    file?: File;
    status: 'original' | 'done' | 'generating' | 'error';
};

interface GarmentDetailModalProps {
  item: WardrobeItem | null;
  isOpen: boolean;
  onClose: () => void;
  onApply: (garmentFile: File, garmentInfo: WardrobeItem) => void;
  isLoading: boolean;
}

const GarmentDetailModal: React.FC<GarmentDetailModalProps> = ({ item, isOpen, onClose, onApply, isLoading }) => {
    const [variations, setVariations] = useState<Variation[]>([]);
    const [selectedVariationIndex, setSelectedVariationIndex] = useState(0);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (item) {
            // Reset state when a new item is opened
            const initialize = async () => {
                try {
                    const originalFile = await urlToFile(item.url, item.name);
                    setVariations([{ hex: 'original', url: item.url, file: originalFile, status: 'original' }]);
                    setSelectedVariationIndex(0);
                    setError(null);
                } catch(err) {
                    setError('Could not load original garment image.');
                    console.error(err);
                }
            };
            initialize();
        }
    }, [item]);

    const handleGenerateVariations = useCallback(async () => {
        if (!item || variations.length === 0 || !variations[0].file) return;
        
        setIsGenerating(true);
        setError(null);
        const originalFile = variations[0].file;

        try {
            const colors = await getHarmonicColors(originalFile);
            
            setVariations(prev => [
                ...prev,
                ...colors.map(hex => ({ hex, url: '', status: 'generating' as const }))
            ]);

            for (const hex of colors) {
                try {
                    const newGarmentUrl = await recolorGarment(originalFile, hex);
                    const newGarmentFile = await urlToFile(newGarmentUrl, `${item.name}-${hex}.png`);
                    
                    setVariations(prev => prev.map(v => 
                        v.hex === hex && v.status === 'generating' 
                        ? { ...v, url: newGarmentUrl, file: newGarmentFile, status: 'done' } 
                        : v
                    ));
                } catch (e) {
                    console.error(`Failed to generate variation for color ${hex}`, e);
                    setVariations(prev => prev.map(v => v.hex === hex ? { ...v, status: 'error' } : v));
                }
            }
        } catch (err) {
            setError('Failed to get color suggestions.');
        } finally {
            setIsGenerating(false);
        }
    }, [item, variations]);

    const handleApply = () => {
        const selectedVariation = variations[selectedVariationIndex];
        if (item && selectedVariation?.file && (selectedVariation.status === 'done' || selectedVariation.status === 'original')) {
            const newInfo: WardrobeItem = {
                ...item,
                id: `${item.id}-${selectedVariation.hex}`,
                name: selectedVariation.status === 'original' ? item.name : `${item.name} (${selectedVariation.hex})`,
                url: selectedVariation.url,
            }
            onApply(selectedVariation.file, newInfo);
        }
    };

    const displayedImage = variations[selectedVariationIndex]?.url || item?.url;
    
    return (
        <AnimatePresence>
            {isOpen && item && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    aria-modal="true"
                    role="dialog"
                >
                    <motion.div
                        initial={{ scale: 0.95, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.95, y: 20 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] grid grid-cols-1 md:grid-cols-2 shadow-xl overflow-hidden"
                    >
                        <div className="relative bg-gray-100 flex items-center justify-center p-6 h-96 md:h-auto">
                           {displayedImage ? (
                                <img
                                    key={displayedImage}
                                    src={displayedImage}
                                    alt={item.name}
                                    className="max-w-full max-h-full object-contain animate-fade-in"
                                />
                           ) : <Spinner />}
                        </div>
                        <div className="flex flex-col p-6 overflow-y-auto">
                            <div className="flex-grow">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-sm font-semibold text-gray-500">{item.brand}</p>
                                        <h2 className="text-3xl font-serif text-gray-900 mt-1">{item.name}</h2>
                                    </div>
                                    <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                                        <XIcon className="w-6 h-6"/>
                                    </button>
                                </div>
                                <p className="text-gray-600 mt-4">{item.description}</p>
                                
                                <div className="mt-8">
                                    <h3 className="text-lg font-serif text-gray-800">Color Variations</h3>
                                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                                        {variations.map((v, index) => (
                                            <button 
                                                key={v.hex}
                                                onClick={() => setSelectedVariationIndex(index)}
                                                className={`w-10 h-10 rounded-full border-2 transition-all flex items-center justify-center
                                                    ${selectedVariationIndex === index ? 'border-gray-800 scale-110' : 'border-transparent hover:border-gray-400'}
                                                    ${v.status === 'error' ? 'bg-red-200' : ''}
                                                `}
                                                style={v.status !== 'error' ? { backgroundColor: v.hex === 'original' ? '#e5e7eb' : v.hex } : {}}
                                                aria-label={v.hex}
                                                disabled={v.status === 'generating' || v.status === 'error'}
                                            >
                                                {v.status === 'original' && <CheckCircleIcon className="w-5 h-5 text-gray-600" />}
                                                {v.status === 'generating' && <Spinner/>}
                                                {v.status === 'error' && <XIcon className="w-5 h-5 text-red-600"/>}
                                            </button>
                                        ))}
                                    </div>
                                    {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                                </div>
                            </div>

                            <div className="mt-8 pt-6 border-t flex flex-col sm:flex-row gap-3">
                                <button
                                    onClick={handleGenerateVariations}
                                    disabled={isLoading || isGenerating}
                                    className="w-full sm:w-auto flex-grow flex items-center justify-center text-center bg-gray-200 text-gray-800 font-semibold py-3 px-4 rounded-lg transition-colors duration-200 ease-in-out hover:bg-gray-300 active:scale-95 text-base disabled:opacity-50 disabled:cursor-wait"
                                >
                                    {isGenerating ? <Spinner /> : <PaletteIcon className="w-5 h-5 mr-2" />}
                                    {isGenerating ? 'Generating...' : 'Generate Colors'}
                                </button>
                                <button
                                    onClick={handleApply}
                                    disabled={isLoading || isGenerating || !variations[selectedVariationIndex]?.file}
                                    className="w-full sm:w-auto flex-grow flex items-center justify-center text-center bg-gray-900 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 ease-in-out hover:bg-gray-700 active:scale-95 text-base disabled:opacity-50 disabled:cursor-wait"
                                >
                                    Apply to Model
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default GarmentDetailModal;
