const readline = require("readline");

async function solve() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    const iter = rl[Symbol.asyncIterator]();
    let tokens = [];
    let p = 0;

    // 稳健的按词读取流，无视空行和脏数据
    async function next() {
        while (p >= tokens.length) {
            const res = await iter.next();
            if (res.done) return null;
            if (!res.value.trim()) continue;
            tokens = res.value.trim().split(/\s+/);
            p = 0;
        }
        return tokens[p++];
    }

    let tStr = await next();
    if (!tStr) return;
    let T = parseInt(tStr);

    let out = [];

    for (let t = 0; t < T; t++) {
        let nStr = await next();
        if (!nStr) break;
        let n = parseInt(nStr);

        let a = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            a[i] = parseInt(await next());
        }

        let b = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            b[i] = parseInt(await next());
        }

        // 1. 离散化坐标压缩，为树状数组做准备
        let sortedA = new Int32Array(a).sort();
        let map = new Map();
        let rank = 1;
        for (let i = 0; i < n; i++) {
            if (i === 0 || sortedA[i] !== sortedA[i - 1]) {
                map.set(sortedA[i], rank++);
            }
        }

        let m = rank - 1;
        let tree = new Int32Array(m + 1);
        
        // 树状数组的基础操作
        function add(idx, val) {
            for (; idx <= m; idx += idx & -idx) tree[idx] += val;
        }
        function query(idx) {
            let sum = 0;
            for (; idx > 0; idx -= idx & -idx) sum += tree[idx];
            return sum;
        }

        let diff = new Int32Array(n + 1); // 差分数组
        let current_count = 0;

        // 2. 遍历数组，计算每个元素左侧大于它的个数，并更新差分数组
        for (let i = 0; i < n; i++) {
            let comp = map.get(a[i]);
            
            // k_i 是当前位置左侧，严格大于 a[i] 的元素个数
            let k_i = current_count - query(comp);
            
            add(comp, 1);
            current_count++;

            // a[i] 元素将会经过的交换边界区间是 [L_i, i - 1]
            let L_i = i - k_i;
            if (L_i <= i - 1) {
                diff[L_i] += 1;
                diff[i] -= 1;
            }
        }

        let cost = 0n; // 使用 BigInt 防止高达上百亿的极端总代价溢出
        let X_j = 0;   // X_j 代表在边界 j 发生的真实交换总次数
        
        // 3. 利用前缀和还原出真实交换次数，并计算总代价
        for (let j = 0; j < n - 1; j++) {
            X_j += diff[j];
            // 每次实际交换代价仅由固定不变的 b_j 决定
            if (b[j] < b[j + 1]) {
                cost += BigInt(X_j);
            }
        }

        out.push(cost.toString());
        
        // 及时刷出缓冲区，防止内存溢出导致超时
        if (out.length >= 10000) {
            process.stdout.write(out.join('\n') + '\n');
            out = [];
        }
    }

    if (out.length > 0) {
        process.stdout.write(out.join('\n') + '\n');
    }
}

solve();