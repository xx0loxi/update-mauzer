// ============================================================
// Bloom Filter для быстрой проверки блокировки доменов
// ============================================================

class BloomFilter {
    constructor(size, numHashes) {
        this.size = size;
        this.numHashes = numHashes;
        this.bits = new Uint8Array(Math.ceil(size / 8));
    }
    
    hash(str, seed) {
        let hash = seed;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash) % this.size;
    }
    
    add(item) {
        for (let i = 0; i < this.numHashes; i++) {
            const pos = this.hash(item, i);
            this.bits[pos >> 3] |= 1 << (pos & 7);
        }
    }
    
    has(item) {
        for (let i = 0; i < this.numHashes; i++) {
            const pos = this.hash(item, i);
            if ((this.bits[pos >> 3] & (1 << (pos & 7))) === 0) {
                return false; // Точно НЕТ в множестве
            }
        }
        return true; // Возможно есть (false positives возможны, но НЕТ false negatives)
    }
}

module.exports = BloomFilter;
