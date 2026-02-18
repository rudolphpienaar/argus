import { describe, it, expect } from 'vitest';
import {
    language_fromPath,
    language_fromCatCommand,
    language_normalize,
    filename_forLanguage
} from './languageRegistry.js';

describe('languageRegistry', () => {
    describe('language_fromPath', () => {
        it('detects basename-only languages', () => {
            expect(language_fromPath('/tmp/Dockerfile')).toBe('dockerfile');
            expect(language_fromPath('Makefile')).toBe('makefile');
        });

        it('detects extension-based languages', () => {
            expect(language_fromPath('train.py')).toBe('python');
            expect(language_fromPath('notes.adoc')).toBe('markdown');
            expect(language_fromPath('/x/data.CSV')).toBe('csv');
            expect(language_fromPath('settings.conf')).toBe('ini');
        });

        it('returns null for unknown or extensionless paths', () => {
            expect(language_fromPath('README')).toBeNull();
            expect(language_fromPath('archive.tar.gz')).toBeNull();
        });
    });

    describe('language_fromCatCommand', () => {
        it('detects language from basic and optioned cat commands', () => {
            expect(language_fromCatCommand('cat train.py')).toBe('python');
            expect(language_fromCatCommand('cat -n ./config.yaml')).toBe('yaml');
        });

        it('handles quoted paths', () => {
            expect(language_fromCatCommand("cat 'docs/story.adoc'")).toBe('markdown');
            expect(language_fromCatCommand('cat "Dockerfile"')).toBe('dockerfile');
        });

        it('returns null for non-cat or invalid commands', () => {
            expect(language_fromCatCommand('echo cat train.py')).toBeNull();
            expect(language_fromCatCommand('cat --help')).toBeNull();
            expect(language_fromCatCommand('cat')).toBeNull();
        });
    });

    describe('language_normalize', () => {
        it('normalizes aliases to canonical IDs', () => {
            expect(language_normalize('YML')).toBe('yaml');
            expect(language_normalize('shell')).toBe('bash');
            expect(language_normalize('md')).toBe('markdown');
        });

        it('returns null for unknown language aliases', () => {
            expect(language_normalize('protobuf')).toBeNull();
        });
    });

    describe('filename_forLanguage', () => {
        it('maps canonical and alias languages to pseudo filenames', () => {
            expect(filename_forLanguage('python')).toBe('snippet.py');
            expect(filename_forLanguage('yml')).toBe('snippet.yaml');
            expect(filename_forLanguage('dockerfile')).toBe('Dockerfile');
        });

        it('falls back to text filename for unknown language tokens', () => {
            expect(filename_forLanguage('protobuf')).toBe('snippet.txt');
        });
    });
});
