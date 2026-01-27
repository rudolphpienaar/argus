
import { VirtualFileSystem } from '../src/core/logic/vfs.js';

const vfs = new VirtualFileSystem();

console.log('Testing VFS...');

// 1. Check Initial State
console.log('Initial CWD:', vfs.getCwd()); // Should be /home/developer
const initialNodes = vfs.getCwdNode()?.children?.map(c => c.name);
console.log('Initial Contents:', initialNodes);

// 2. Make Directory
console.log('mkdir test_dir...');
vfs.mkdir('test_dir');
const newNodes = vfs.getCwdNode()?.children?.map(c => c.name);
console.log('Contents after mkdir:', newNodes);

// 3. Change Directory
console.log('cd test_dir...');
const newPath = vfs.cd('test_dir');
console.log('New CWD:', newPath); // Should be /home/developer/test_dir

// 4. Create File
console.log('touch file.txt...');
vfs.touch('file.txt');
const innerNodes = vfs.getCwdNode()?.children?.map(c => c.name);
console.log('Contents of test_dir:', innerNodes);

// 5. Navigate Up
console.log('cd ..');
const upPath = vfs.cd('..');
console.log('Back to CWD:', upPath);

// 6. Absolute Path Navigation
console.log('cd /home/developer/projects...');
try {
    vfs.cd('/home/developer/projects'); // Current impl might not support full absolute paths string parsing in cd() yet?
    console.log('Absolute cd success:', vfs.getCwd());
} catch (e: any) {
    console.log('Absolute cd failed (expected if not implemented):', e.message);
}

// 7. Resolve Path
const resolved = vfs.resolve(['home', 'developer', 'test_dir', 'file.txt']);
console.log('Resolved file exists:', !!resolved);
