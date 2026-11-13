'use strict';

function readyPodNames(podList) {
    return (podList.items ?? [])
        .filter((pod) => {
            if (pod.metadata?.deletionTimestamp) {
                return false;
            }
            if (pod.status?.phase !== 'Running') {
                return false;
            }
            return (pod.status?.conditions ?? []).some((item) => item.type === 'Ready' && item.status === 'True');
        })
        .map((pod) => pod.metadata.name)
        .sort();
}

function pdbSnapshot(pdb) {
    return {
        healthy: pdb.status?.currentHealthy ?? 0,
        minAvailable: pdb.spec?.minAvailable ?? pdb.status?.desiredHealthy,
        disruptionsAllowed: pdb.status?.disruptionsAllowed ?? 0,
    };
}

function judgeEvictions(first, second) {
    const problems = [];
    if (first !== 201) {
        problems.push(`evict-1=${first}, а має бути 201`);
    }
    if (second !== 429) {
        problems.push(`evict-2=${second}, а має бути 429`);
    }
    return problems;
}

module.exports = { readyPodNames, pdbSnapshot, judgeEvictions };